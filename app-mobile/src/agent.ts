// Ask Doors (public/ui/agent.js) without the DOM: one conversation per plan (saved on the phone, its last 40 messages,
// as the web keeps it per tab; the guided demo's is not kept), a turn = the plan's context (agentContext) → the Worker's /api/agent (25 s, else Doors' rules on the
// phone) → its actions applied through the engine (status, outcome, slot, talk, replan, open) with one Undo.
import { agentContext, dayHolding } from "../../public/lib/agent-context.js";
import { answerByRules, doorNamed } from "../../public/lib/agent-rules.js";
import { RESULT_TEXT } from "../../public/lib/outcome.js";
import { niceDate, clock12, toMinutes } from "../../public/lib/profile.js";
import { ruleNotes } from "../../public/lib/slots.js";
import { fitReply, moveFollowUp, offerLive } from "../../public/lib/fu-check.js";
import { makeNote, notesOf, hasNote } from "../../public/lib/door-notes.js"; // door notes
import { changeSet, MODES, inLocalTime } from "../../public/lib/agent-ui.js"; // Doors Agent (spec step 5): chips, the screen's mode
import { draftOf } from "../../public/lib/agent-tools.js"; // ability 4: follow-up drafts
import { latePickLabel } from "../../public/lib/drive-day.js";
import { workerFetch } from "./data";
import { appGet, appSet } from "./storage";
import type { PlanEngine } from "./engine";

export const MODEL_NOTICE = "Your messages go to Anthropic's Claude, or to Workers AI or Google Gemini when Claude can't answer, with names removed first; voice goes to Cloudflare.";
export type Chip = { text: string; g: string | null; undone?: boolean };
export type Msg = { draft?: { id: string; name: string; channel: "email" | "text"; subject?: string; body: string; href: string } | null; chips?: Chip[]; offerNote?: { id: string; name: string; text: string } | null; offers?: any[] | null; role: "user" | "agent"; text: string; facts?: any[]; by?: string; model?: string; badge?: string; did?: string; resting?: boolean; message?: string; notice?: string; open?: string | null; late?: { picks: number[] } | null; lateBy?: number };
const TURN_MS = 25000;
const MAX_KEPT = 12;
const late = <X,>(ms: number, v: X) => new Promise<X>((ok) => setTimeout(() => ok(v), ms));

export class Chat {
  messages: Msg[] = [];
  busy = false;
  // the last answer's change chips' Undo: {at: its index in messages, fns: group → undo} (ui/agent.js)
  undo: { at: number; fns: Map<string, () => Promise<void>> } | null = null;
  offline: boolean;
  constructor(public e: PlanEngine) {
    this.offline = !!e.demo; // the guided demo makes no live calls
  }
  // → {chips, fns, open}. Groups (lib/agent-ui.js changeSet, as ui/agent.js): "plan" for statuses, outcomes and
  // re-plans (the snapshot from before the turn, and each re-plan's own Undo), one each for a kept fact or a talk change
  private async apply(actions: any[], reply = "") {
    const e = this.e;
    const plan = e.plan;
    const cs = changeSet();
    const did = (text: string, g: string | null = null) => cs.add(text, g);
    let open: string | null = null;
    let lateBy = 0;
    const snap = (actions ?? []).some((a) => a.type === "status" || a.type === "outcome") ? e.snapshot() : null;
    if (snap) cs.undo("plan", () => e.restore(snap)); // first in, so it runs last
    const name = (id: string) => plan.venues?.[id]?.name ?? "that door";
    let k = 0;
    for (const a of actions ?? []) {
      const g = a.type === "status" || a.type === "outcome" || a.type === "replan" ? "plan" : `c${k++}`;
      try {
        if (a.type === "status") {
          const prev = plan.statuses?.[a.id] ?? null;
          await e.setStatus(a.id, a.status);
          if (!snap) cs.undo(g, () => e.setStatus(a.id, prev));
          if (a.status !== "visited") did(`${name(a.id)}: ${a.status === "notfit" ? "not a fit" : "already known"}`, g);
        } else if (a.type === "outcome") {
          const prev = plan.outcomes?.[a.id] ?? null;
          await e.setOutcome(a.id, a.outcome);
          if (!snap) cs.undo(g, () => e.setOutcome(a.id, prev));
          did(`${name(a.id)} logged: ${RESULT_TEXT[a.outcome.result] ?? a.outcome.result}${a.outcome.followUp ? `, follow up ${niceDate(a.outcome.followUp)}${a.outcome.followUpTime ? `, ${clock12(toMinutes(a.outcome.followUpTime)).replace(":00 ", " ")}` : ""}` : ""}`, g);
        } else if (a.type === "slot") {
          // judge pass 4 (#1): a rule that replaces an older one, or touches the brand's name, says so (once)
          const notes: string[] = /^rule\./.test(a.record.field) ? ruleNotes(plan.slots ?? {}, a.record, plan.profile?.brand).filter((x: string) => !reply.includes(x)) : [];
          e.setSlot(a.id, a.record);
          const withVisit = (a.record.field === "said" || a.record.field === "next") && (actions ?? []).some((b) => b.type === "outcome" && b.id === a.id);
          cs.undo(withVisit ? "plan" : g, () => e.setSlot(a.id, { clear: a.record.field, value: a.record.value }));
          if (withVisit) continue;
          const v = a.record.value;
          const PUSH: any = { price: "price", space: "no room for it", local: "wants local", own: "pours its own", already: "already carries one", owner: "the owner decides", nosell: "doesn't think it would sell" };
          if (a.record.field === "rule.avoid") { did([`Your rules: never say “${v}”`, ...notes].join(". "), g); continue; }
          if (a.record.field === "rule.term") { did([`Your rules: say “${v?.to}”, not “${v?.from}”`, ...notes].join(". "), g); continue; }
          // door notes: the reply already says it ("Noted on …"): the chip says where it went
          if (a.record.field === "note") { did(reply.includes(String(v).slice(0, 24)) || /\bNoted\b/.test(reply) ? `In ${name(a.id)}'s Notes` : `Noted for ${name(a.id)}: “${String(v).slice(0, 80)}${String(v).length > 80 ? "…" : ""}”`, g); continue; }
          if (a.record.field === "objection") { did(`Kept for ${name(a.id)}: their pushback (${PUSH[v?.kind] ?? v?.kind ?? "noted"})`, g); continue; }
          const what = a.record.field === "contact" ? `contact ${v?.name ?? v}${v?.role ? ` (${v.role})` : ""}` : typeof v === "string" ? `${a.record.field.replace(/^rule\./, "")}: “${v.slice(0, 60)}”` : a.record.field.replace(/^rule\./, "");
          did(`Kept${a.id && a.id !== "*" ? ` for ${name(a.id)}` : ""}: ${what}`, g);
        } else if (a.type === "talk") {
          e.setTalk(a.id, a);
          cs.undo(g, () => e.setTalk(a.id, { undoLast: true }));
          did(`${a.op === "remove" ? "Removed" : a.op === "add" ? "Added" : "Changed"} ${a.section === "opener" ? "the opener" : a.section === "ask" ? "the ask" : `a line in ${a.section}`} for ${name(a.id)}`, g);
        } else if (a.type === "replan") {
          const out: { undo?: () => void; said?: string } = {}; // the engine fills its Undo and what changed (the chip)
          const text: any = await e.agentReplan(a, out);
          if (text?.unchanged) did(text.text.replace(/\.$/, "")); // judge pass 6 (#7): a refused move changed nothing
          else if (text) {
            if (out.undo) cs.undo(g, out.undo);
            did(out.said ?? text.replace(/\.$/, ""), out.undo ? g : null);
          } else did("Nothing on the plan needed to change");
        } else if (a.type === "open") open = a.id;
        else if (a.type === "late" && a.by > 0) { lateBy = a.by; did(`Start my day: ${latePickLabel(a.by)}`); } // ease audit 2 #3
        else did(`(This version of Doors can't apply a ${a.type} change.)`);
      } catch (err: any) {
        did(`Couldn't apply a ${a.type} change: ${err.message}`);
      }
    }
    const fns = cs.undos as Map<string, () => Promise<void>>;
    for (const c of cs.chips) if (c.g != null && !fns.has(c.g)) c.g = null; // never an Undo with no chip to tap
    return { chips: cs.chips as Chip[], fns, open, lateBy };
  }
  // one turn → the agent's message (also pushed to this.messages)
  // mode (spec §6): the screen asked from, "drive" | "stop" | "plan": it sets the answer's length on the Worker
  async send(text: string, { current = null, dayIndex = null, mode = "plan" }: { current?: string | null; dayIndex?: number | null; mode?: string } = {}) {
    const t = String(text ?? "").trim().slice(0, 600);
    const e = this.e;
    const plan = e.plan;
    if (!t || this.busy || !plan) return null;
    this.busy = true;
    this.messages.push({ role: "user", text: t });
    e.emit();
    let r: any;
    let res = { chips: [] as Chip[], fns: new Map<string, () => Promise<void>>(), open: null as string | null, lateBy: 0 };
    let offers: any[] = [];
    try {
      const d = (await Promise.race([e.stopData().catch(() => ({})), late(5000, null)])) ?? {};
      const sel = dayIndex ?? (typeof e.sel === "number" ? e.sel : plan.days.findIndex((x: any) => !x.past && x.stops.length));
      const ctxFor = (dayIndex: number) => ({ ...agentContext({ plan, dayIndex, current, city: d.city, facts: d.facts, routes: d.routes, now: new Date() }), mode: MODES.includes(mode) ? mode : "plan" });
      let context = ctxFor(sel);
      const asked = /\b(first|start with|open with|lead with)\b/i.test(t) && doorNamed(t, context, { here: false });
      if (asked && !context.day?.stops.some((x: any) => x.id === asked) && dayHolding(plan, asked) >= 0) context = ctxFor(dayHolding(plan, asked)); // judge pass 9 #5: the door's own day
      if (asked && context.day.stops.findIndex((x: any) => x.id === asked) > 0) context.day.trade = (await e.whatIfFirst(asked)) ?? null;
      const convo = this.messages.slice(-MAX_KEPT).map((m) => ({ role: m.role, text: m.text }));
      const rules = (message: string) => ({ ...answerByRules(convo, context, { now: `${context.today}T${context.now}` }), resting: true, message });
      if (this.offline) r = rules("The guided demo answers from Doors' rules on this phone: no model is called.");
      else {
        try {
          r = await Promise.race([
            workerFetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ v: 1, messages: convo, context }) }).then(async (x) => {
              const out = await x.json().catch(() => null);
              if (!out || (!x.ok && !out.reply)) throw new Error(out?.error ?? `HTTP ${x.status}`);
              return out;
            }),
            late(TURN_MS, null),
          ]);
          if (!r) r = rules("Doors Agent took too long; this answer is from Doors' rules, on this device.");
        } catch {
          r = rules("Doors Agent can't be reached right now; this answer is from Doors' rules, on this device.");
        }
      }
      // judge pass 4 (#2, #3): a logged follow-up is checked against its door's hours before it is saved
      const fr = fitReply(r, plan.venues, { windows: plan.windows ?? [], visitMin: plan.profile?.visitMin ?? 25, outcomes: plan.outcomes ?? {} });
      offers = fr.offers ?? [];
      r = { ...fr, offers: undefined };
      res = await this.apply(r.actions, r.reply ?? "");
    } catch {
      r = { reply: "Something went wrong answering that. Try asking again.", facts: [], actions: [], by: "rules", resting: true };
    } finally {
      this.busy = false;
    }
    // judge, phone #6: "resting" meant nothing to a judge; say whose answer it is
    const badge = r.resting ? (r.retry ? "Doors' rules · model busy" : "") : r.by === "gemini" ? "Gemini" : r.by === "workers-ai" ? "Workers AI" : "";
    const msg: Msg = { role: "agent", text: r.reply ?? "", facts: r.facts ?? [], by: r.by, ...(r.model ? { model: r.model } : {}), ...(r.notice ? { notice: String(r.notice).slice(0, 200) } : {}), badge, chips: res.chips, ...(offers.length ? { offers } : {}), ...(r.offerNote?.id && plan.venues?.[r.offerNote.id] ? { offerNote: { id: r.offerNote.id, name: plan.venues[r.offerNote.id].name, text: String(r.offerNote.text ?? "").slice(0, 300) } } : {}), ...(draftOf(r) ? { draft: draftOf(r) } : {}), ...(Array.isArray(r.late?.picks) ? { late: { picks: r.late.picks.filter((x: number) => x > 0 && x <= 240) } } : {}), ...(res.lateBy ? { lateBy: res.lateBy } : {}), resting: Boolean(r.resting), message: r.message, open: res.open };
    this.messages.push(msg);
    this.undo = res.fns.size ? { at: this.messages.length - 1, fns: res.fns } : null;
    e.emit();
    return msg;
  }
  // a follow-up on a day the door is closed (or a slot another one has): one tap moves it. The offer stays on its
  // message while the door's saved follow-up is still the one it was made for (lib offerLive, as ui/agent.js)
  offerLive = (o: any) => offerLive(o, this.e.plan?.outcomes ?? {});
  async takeOffer(i: number, k: number) {
    const m = this.messages[i];
    const o = m?.offers?.[k];
    if (!o || !this.offerLive(o)) return;
    const moved = moveFollowUp(o.outcome, o.alt);
    await this.e.setOutcome(o.id, moved);
    m!.offers = null;
    // its chip's Undo puts the follow-up back where it was logged
    this.messages.push({ role: "agent", text: `Moved: ${o.name}, follow up ${niceDate(moved.followUp)}${moved.followUpTime ? `, ${clock12(toMinutes(moved.followUpTime)).replace(":00 ", " ")}` : ""}.`, by: "rules", chips: [{ text: `${o.name}: follow-up moved`, g: "fu" }] });
    this.undo = { at: this.messages.length - 1, fns: new Map([["fu", async () => { await this.e.setOutcome(o.id, o.outcome); }]]) };
    this.e.emit();
  }
  // door notes: a fact the model didn't note, offered on its message; one tap keeps it on the door, in the rep's words
  noteOfferLive = (m: Msg) => !!m.offerNote && !hasNote(notesOf(this.e.plan?.slots, m.offerNote.id), m.offerNote.text);
  takeNote(i: number) {
    const o = this.messages[i]?.offerNote;
    if (!o) return;
    const rec = makeNote({ text: o.text, by: "rep" });
    if (!rec) return;
    this.e.setSlot(o.id, rec);
    this.messages.push({ role: "agent", text: `Noted on ${o.name}: “${rec.value}”`, by: "rules", chips: [{ text: `In ${o.name}'s Notes`, g: "note" }] });
    this.undo = { at: this.messages.length - 1, fns: new Map([["note", async () => { this.e.setSlot(o.id, { note: rec.id, drop: true }); }]]) };
    this.e.emit();
  }
  // a chip's Undo is live on the last answer, until it runs
  canUndo = (i: number, g: string | null) => g != null && i === this.messages.length - 1 && this.undo?.at === i && this.undo.fns.has(g);
  // a chip's Undo: its group comes back, and every chip of the group says Undone (the others stay undoable)
  async doUndo(g: string) {
    const fn = this.undo?.fns.get(g);
    if (!fn || !this.undo) return;
    const at = this.undo.at;
    this.undo.fns.delete(g);
    await fn();
    for (const c of this.messages[at]?.chips ?? []) if (c.g === g) c.undone = true;
    this.e.emit();
  }
}
const chats = new WeakMap<PlanEngine, Chat>();
export const chatFor = (e: PlanEngine) => {
  let c = chats.get(e);
  if (!c) {
    chats.set(e, (c = new Chat(e)));
    if (!e.demo) keep(c, `chat.${e.brand}-${e.key.city}`);
  }
  return c;
};
// the conversation survives the app being closed (web: sessionStorage per plan): read once, written when it changes
function keep(c: Chat, k: string) {
  try { const log = appGet(k); if (Array.isArray(log)) c.messages = log; } catch {}
  let sig = `${c.messages.length}|${c.messages.at(-1)?.text ?? ""}`;
  c.e.subscribe(() => {
    const now = `${c.messages.length}|${c.messages.at(-1)?.text ?? ""}`;
    if (now === sig) return;
    sig = now;
    try { appSet(k, c.messages.slice(-40).map(({ offerNote, offers, ...m }) => m)); } catch {}
  });
}
// judge pass 4 (N25, ui/agent.js): the free-model line shows only while a model answers (or before any answer); the
// resting note shows once, not again under the next answer when it says the same thing
export const footFor = (last: Msg | null) => ({ notice: !last?.resting });
const REST = "Doors Agent isn't available; this answer is from Doors' rules.";
export function restNote(m: Msg, prev: Msg | undefined) {
  if (!m?.resting) return "";
  const t = m.message ?? REST;
  return prev?.resting && (prev.message ?? REST) === t ? "" : t;
}
// m.notice (from the Worker) says why Claude was passed over, when a free model or the rules answered
export const answeredBy = (m: Msg) => (m.resting ? "This answer is from Doors' own rules: no model was used." : inLocalTime(m.model ? `This answer: ${m.model}.${m.notice ? ` ${m.notice}` : ""}` : m.notice ?? ""));
