// WHY-VIZ-SPEC §6 Your list rows: a 120 px strip per row, so a quiet #3 and a loud #2 read without numbers. A hairline
// from "unknown" to "everyone knows it" (Qloo popularity 0–1), Doors' big-names tick at the popularity cap (0.9, the
// route filter's popularityMax), and a dot at the door's own popularity: filled green on a day, a green ring on Your
// list and not on a day, grey when the rep marked it. No numbers anywhere (Jard 10-23). Pure: no DOM.
import { popWords } from "../core.js";

export const BIG_LINE = 0.9; // Doors' popularity cap (route filter.popularityMax; the explorer draws the same line)

// {pop, onDay, marked, big?} → {pop, x (0–1 | null), tick, cls: "plan" | "list" | "off" | "big" | "none", word, text}
export function stripModel({ pop = null, onDay = false, marked = false, big = false, max = BIG_LINE } = {}) {
  const p = typeof pop === "number" && Number.isFinite(pop) ? Math.min(1, Math.max(0, pop)) : null;
  const cls = p == null ? "none" : marked ? "off" : onDay ? "plan" : big || p >= max ? "big" : "list";
  const word = p == null ? "" : popWords(p);
  const text = p == null ? "Qloo has no popularity for this door" : `How well known: ${word}${p >= max ? ", past Doors' big-names line" : ""}`;
  return { pop: p, x: p, tick: max, cls, word, text };
}
