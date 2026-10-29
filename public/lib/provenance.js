// Where each talking point came from, as a chip the stop shows beside it: read off the
// traces stopModel already carries (talk.deep.*.src, talk.hook.src, talk.openerSource, pushback from "memory",
// talk.memoryUsed, talk.edited, model lines), never guessed from the words alone where a trace exists.
// k: "qloo" (Qloo's data) · "you" (what the rep told Doors: the visit, the profile) · "edit" (the rep's own edit) ·
// "model" (model-drafted) · "tpl" (Doors' template). Words follow docs/CULTURAL-SLOTS.md §3.2 in short form.
// Pure: no DOM.

const chip = (k, label, title = "") => ({ k, label, title });
const tagsTitle = (src) => (src ? `Qloo, ${String(src.field ?? "").replace(/^tag:/, "").replace(/_/g, " ")}: ${(src.tags ?? []).join(", ")}` : "");

export const QLOO_TAGS = (src) => chip("qloo", "from Qloo · door tags", tagsTitle(src));
export const QLOO_HEAT = (src) => chip("qloo", "from Qloo · heatmap", src?.tags?.length ? `Qloo's heatmap of where the drinker brand's fans are: ${src.tags.join(", ")}` : "");
export const QLOO_TASTE = (src) => chip("qloo", "from Qloo · taste data", src?.brand ? `Qloo: ${src.brand} drinkers' tastes; this door's tag: ${src.room}` : "");
export const QLOO_ROOM = chip("qloo", "from Qloo · door profile", "Qloo's description of this door's crowd");
export const QLOO_RANK = chip("qloo", "from Qloo · rank", "Qloo's taste ranking for your drinker");
export const QLOO_SISTERS = chip("qloo", "from Qloo · sister doors", "Doors Qloo matches to this door's crowd");
export const NOTE = chip("you", "from your note", "What you told Doors after your last visit");
export const PROFILE = chip("you", "from your profile", "What you told Doors in your brand profile");
export const EDIT = chip("edit", "your edit", "You changed this line");
// judge pass 2 (6): a line Ask Doors rewrote is Doors' edit, not the rep's; one that kept Qloo's crowd line says so
export const DOORS_EDIT_QLOO = chip("qloo", "Doors' edit · from Qloo", "Doors Agent shortened this line and kept the crowd line from Qloo's profile of this door");
export const DOORS_EDIT = chip("tpl", "Doors' edit", "Doors Agent rewrote this line at your request");
const editChip = (t, section) => (t.edited[section] === "rep" ? EDIT : t.editedFrom?.[section] === "qloo" ? DOORS_EDIT_QLOO : DOORS_EDIT);
export const MODEL = chip("qloo", "from Qloo · door profile", "From Qloo's profile of this door"); // round 3: no model named on the door (the privacy page says it)
// group 3 item 3 (lib/talk-gen.js): a line written for this door from Qloo's facts, checked against them. Round 3 (Jard
// 10-25): it counts as a Qloo line and names no model; the privacy page says a model writes them
export const WRITTEN = chip("qloo", "from Qloo · this door's facts", "Built for this door from Qloo's facts about it, your product and your ask, and checked against those facts");
export const TEMPLATE = chip("tpl", "Doors template", "Doors' own wording, filled in with your profile");

// the angle's chip (Jard 10-24 #5): Qloo's crowd text → the door profile; a room tag → door tags; nothing → the template
const angleChip = (src) => (!src ? TEMPLATE : src.field === "customer_demographics_description" ? QLOO_ROOM : QLOO_TAGS(src));
// lineSources(m) → {before[], opener, toBuyer, hook, questions[], points[], pushback[], ask} for m = stopModel(…).
// A null entry means the line has no chip of its own (its fact footnote is its source).
export function lineSources(m) {
  const t = m.talk;
  const dp = t.deep ?? {};
  const mem = m.memory ?? null;
  const p = m.profile ?? {};
  const used = new Set(t.memoryUsed ?? []);
  const price = String(p.pitch?.price ?? p.price ?? "").trim();

  const before = t.before.map((x) => {
    if (dp.tod && x === dp.tod.text) return QLOO_TAGS(dp.tod.src);
    if (/^Why you're here:/.test(x)) return QLOO_RANK;
    if (/^(Rooms like it|Sister doors): /.test(x)) return QLOO_SISTERS; // judge pass 4 (N24)
    if (mem && /^Ask for /.test(x) && used.has("contact")) return NOTE;
    if (mem && (/^Your note from last time:/.test(x) || /^They were interested last time/.test(x) || /say you're back/.test(x))) return NOTE;
    if (/^Bring cold samples/.test(x) && price && x.includes(price)) return PROFILE;
    if (t.written?.angle && /^Your angle: /.test(x)) return WRITTEN;
    if (t.angle && /^Your angle: /.test(x)) return angleChip(t.angle.src?.find((s) => s.field !== "tag:menu_highlight" || t.angle.key === "spirit-cocktail"));
    if (/^Order something/.test(x) && /known for/.test(x)) return QLOO_TAGS(t.angle?.src?.find((s) => s.field === "tag:menu_highlight"));
    return TEMPLATE;
  });
  const toBuyer = !t.toBuyer ? null : t.edited?.toBuyer ? editChip(t, "toBuyer") : t.written?.toBuyer ? WRITTEN : angleChip(t.angle?.src?.find((s) => s.field !== "tag:menu_highlight" || t.angle.key === "spirit-cocktail"));

  const lead = dp.lead?.question;
  const opener = t.edited?.opener ? editChip(t, "opener")
    : mem ? NOTE
    : t.written?.opener ? WRITTEN
    : t.lines?.opener === "model" ? MODEL
    : lead && (t.opener.endsWith(lead) || t.opener.endsWith(lead.replace(/^When one of your regulars\b/, "When one of them"))) ? QLOO_TAGS(dp.lead.src?.[0])
    : t.openerSource ? QLOO_ROOM
    : TEMPLATE;

  const questions = t.questions.map((q) => (t.by === "model" ? WRITTEN : dp.lead?.gate && q === dp.lead.gate ? QLOO_TAGS(dp.lead.src?.[0]) : TEMPLATE));
  const brand = String(p.brand ?? "").trim();
  const points = t.points.map((pt) => (pt.model ? WRITTEN : pt.by === "model" ? MODEL
    : pt.fact ? null
    : pt.margin ? PROFILE // persona MUST #2: the margin line is built from the rep's own price
    : /(rooms|doors) whose regulars Qloo matches/.test(pt.text) ? QLOO_SISTERS
    : brand && pt.text.startsWith(brand) ? PROFILE
    : TEMPLATE));
  const pushback = t.pushback.map((pb) => (pb.from === "memory" ? NOTE : pb.model ? WRITTEN : TEMPLATE));
  const ask = t.edited?.ask ? editChip(t, "ask")
    : dp.lead?.ask && t.ask === dp.lead.ask ? QLOO_TAGS(dp.lead.src?.[0])
    : String(p.pitch?.ask ?? p.ask ?? "").trim() && t.ask === String(p.pitch?.ask ?? p.ask).trim() ? PROFILE
    : TEMPLATE;
  return { before, opener, toBuyer, hook: t.hook ? QLOO_TASTE(t.hook.src) : null, questions, points, pushback, ask };
}

// How many lines on the stop came from each kind: the legend's counts ("4 from Qloo · 3 from you · 9 template").
export function sourceCounts(s) {
  const all = [...s.before, s.opener, s.toBuyer, s.hook, ...s.questions, ...s.points, ...s.pushback, s.ask].filter(Boolean);
  const n = { qloo: 0, you: 0, edit: 0, model: 0, tpl: 0 };
  for (const c of all) n[c.k]++;
  return n;
}

// intuit audit #4 (both personas: "I want the line I'll say, not where it came from"): the Talking points page keeps one
// line at its top ("4 lines from Qloo, 4 from you, 8 from the template · some lines drafted by a model · Sources below")
// and lists each line's source in a Sources fold at its end; nothing is dropped, it moves. Web and phone say the same.
const SECTION = { before: "Before you walk in", opener: "Opener", toBuyer: "To the buyer", hook: "Small talk", questions: "Question", points: "Point", pushback: "Pushback", ask: "The ask" };
export function sourceRows(s) {
  const rows = [];
  for (const k of Object.keys(SECTION)) {
    const v = s[k];
    const list = Array.isArray(v) ? v : [v];
    list.forEach((c, i) => {
      if (!c || c.k === "tpl") return;
      const where = Array.isArray(v) ? (k === "before" ? `${SECTION[k]}, line ${i + 1}` : `${SECTION[k]} ${i + 1}`) : SECTION[k];
      rows.push({ where, label: c.label.replace(/^from /, "").replace(/^\w/, (x) => x.toUpperCase()), title: c.title ?? "", k: c.k });
    });
  }
  return rows;
}
// Round 3 (Jard 10-25): the tally never says a model wrote anything ("10 written by Claude" is gone); the lines built
// from Qloo's facts count as Qloo's
export function talkSummary(s, t) {
  const n = sourceCounts(s);
  const parts = [n.qloo && `${n.qloo} from Qloo`, n.you && `${n.you} from you`, n.edit && `${n.edit} your edit${n.edit > 1 ? "s" : ""}`, n.tpl && `${n.tpl} from the template`].filter(Boolean);
  if (parts.length) parts[0] = parts[0].replace(/^(\d+) /, (_, k) => `${k} line${k === "1" ? "" : "s"} `);
  return [parts.join(", "), "Sources below"].filter(Boolean).join(" · ");
}
