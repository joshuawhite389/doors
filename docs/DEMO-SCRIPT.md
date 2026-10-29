# Doors: the 2-minute demo, and the guided tour's R9 cards

Two things live here: (1) the spoken 2-minute walkthrough (RULES.md asks for no video; this
is for anyone showing Doors live or recording one), and (2) the guided tour's newer cards, each
landing only when its feature is merged on v2-tour.

**Status marks.** ✅ merged and verified on v2-tour · ⏳ not merged yet (do not show, do not claim) · 🧪 merged, claim
untested (say "untested" or leave it out).

## 1. The 2-minute walkthrough (≈ 300 spoken words)

Open the hosted app, click **Watch the tour**. Every number below comes from the guided demo, which makes no live calls.

| Time | On screen (tour card) | Say | Status |
|---|---|---|---|
| 0:00 | Landing | "A drink brand gets a few days to open a new city. Doors picks which bars and restaurants to visit from Qloo's taste data: the doors whose regulars drink like your customers, before anyone there pours you." | ✅ |
| 0:12 | 1–5, the profile filling in | "Maya runs Tidewell, a made-up non-alcoholic IPA. Her customers drink Athletic Brewing. That one brand is the signal: Qloo ranks every Austin bar by how closely its regulars' tastes match Athletic Brewing drinkers'." | ✅ |
| 0:25 | 6–7, Tuesday's route draws | "Doors keeps the doors open when she'd arrive and plans each afternoon as a loop on real roads: ten doors Tuesday in a 19-road-mile loop." | ✅ |
| 0:35 | 8–9, Doors Agent: "Nomadic Beerworks is ranked #1, so why isn't it her first stop?" | "She can ask. It's stop six because the day is ordered by driving and opening hours; it's Qloo's number one for her drinkers. Every fact says where it came from, with the date Qloo was asked." | ✅ (rules in the demo) |
| 0:50 | 10–14, the #1 stop: why, what to say, a shorter opener | "Every stop has why this door, a note to send, what to say at the door. She asks for a shorter opener; Doors rewrites that one line, and Undo puts it back. It's Qloo's taste data, not a distribution check." | ✅ |
| 1:10 | 15–17, Log visit → Interested, Thursday → the week re-plans | "She marks it. The days ahead re-plan, and the toast says exactly what moved." | ✅ |
| 1:18 | 18, Thursday: the follow-up visit: the same card before and after the visit | "Thursday she goes back. The card changed: ask for Sam by name, no pitch to people who heard it, her price worry answered first, a shorter note. Only what she logged changed it." | ✅ |
| 1:28 | 19–21, Start my day → Log visit: "liked it, come back at 3 on the 29th, hesitant about price" → read back → next door | "In the car there's one big Log visit button. She says how it went; Doors files the outcome, the follow-up and her words, reads it back, and moves her to the next door." | ✅ (typed in the demo) |
| 1:44 | 22, the same brand, another city | "Same brand, Boise instead of Austin: a different number one: Austin's is #17 by popularity alone, Boise's #3. Each has its own crowd in Qloo's own words." | ✅ (facts; no judged claim) |
| 1:54 | 23, hand-off | "Everything here is the real app. Change the brand or the city and build your own." | ✅ |

Words to avoid while talking: "culturally grounded" as a general claim (say what was tested, §3), "AI knows your
customers", anything about what a bar stocks or pours unless the rep said it.

## 2. The tour's R9 cards

inline, folded, **≤ 22 cards in all**, one agent beat early (judges may not reach card 20), and
anything that doesn't change what a judge believes is cut. Done on v2-story: `start`+`windows` → `day`, `pitch`+`known`
→ `pitch`, `note` folded into `talk`, `contact` folded into `open`. Then every R9 card landed: **21 counted + the
hand-off = 22**. The grounding build (2026-10-22) adds `back`: 22 counted + the hand-off.

**Zero live calls:** the demo refuses every same-origin `/api/` request (`window.__demo.blocked`); the agent's turns
go through `ui/agent.js setTransport` to `lib/agent-rules.js answerByRules` in the page (the recorded Gemini
fixtures were taken on another stop and are not public, so they are not replayed), labelled "rules"; drive mode's log-visit falls back to `lib/visit-parse.js` on the refused call.

The order (✅ = landed on v2-story; demo-cdp runs all 22 at 1400 and 390, agent turns 2, Qloo/model calls 0):

| # | Key | Act | Title | What it drives |
|---|---|---|---|---|
| 1–5 | intro, drinker, day, pitch, build | | the profile | the form |
| 6–7 | building, tuesday | | Tuesday's route | the plan |
| 8–9 | ✅ `askwhy`, `answer` | click, continue | Ask Doors Agent why · An answer with its sources | panel opened, `#agentInput` pre-filled "Nomadic Beerworks is ranked #1. Why isn't it my first stop?"; CTA Click **Send** (`button[data-agent=send]`); waits on `doors:agent-reply`; points at `.agent-facts` (each fact with its source in CULTURAL-SLOTS §3.2 words) |
| 10–13 | week, open, why, talk | | the week, the #1 stop | |
| 14 | ✅ `shorter` | click | A shorter opener | `#agentInput` "Make the opener for Nomadic Beerworks shorter" → `talk` action; `.agent-did` + `button[data-agent=undo]` |
| 15–17 | visit, outcome, replan | | the loop | |
| 18 | ✅ `back` | continue | Thursday: the follow-up visit | after `replan`: `lib/demo-return.js` on two real stop models of the #1 stop on its follow-up day, visit memory on vs `slotsOff: ["S4"]`; rows who / her note / opener / first pushback / note, changed ones highlighted with what in her log changed them. The outcome card fills who ("Sam, the bar manager") and a note; the visit is logged at the stop's Tuesday slot (`ui/outcome.js setOutcomeClock`) |
| 19 | ✅ `drive` | click | In the car | `[data-drive-start]` → `section#drive`, `[data-drive-door]` |
| 20 | ✅ `done` | click | Log visit by voice | `[data-drive-done]` → `#drive-text` "done, liked it, come back <Thu's date> at 3, hesitant about price" (a date, not "Thursday": a weekday is read as this week's) → `[data-drive-log]`; the mic is hidden in the demo |
| 21 | ✅ `save` | click | Read back, then the next door | `[data-drive-readback]` → Click **Save & next door** → the next `[data-drive-door]`, then drive closes |
| 22 | ✅ `swap` | continue | Same brand, another city | `lib/demo-swap.js` → `lib/stopmodel.js` on held Athletic Brewing Austin + Boise files (the pair the proof harness measures); each side: Qloo's rank vs popularity alone, its sister doors, the first clause of Qloo's crowd words; one source line under both ("Qloo's data, Oct 8"); no opener; a judged result goes in only when the proof job has one |
| 23 | handoff | end | | |

## 3. What the submission may say (claim discipline)

From `docs/CULTURAL-SLOTS.md` §3.2 and §7.6 and the Cultural Slot Framework §8:

- Sources in plain words, verbatim: corrected "your correction", stated "what you told Doors", observed "what you did",
  qloo "Qloo's data (captured <date>)", inferred "a guess" (never shown as fact), default "Doors' template".
- A grounding result is printed only as "preferred by k of n judges (who) on N scenarios", from the proof job's run.
  Anything not run is "untested". No general "culturally grounded" claim.
- "Agentic" here means: the chat's model proposes tool calls and code validates each one against the plan before it
  acts (contract §0), and the live run plans and makes its own ~20 Qloo calls. Say both plainly; say it runs on Anthropic's
  Claude Haiku (Sonnet with web search for a door's news), then Workers AI's Llama and Gemini's free tier, and that
  Doors' rules answer when no model can.
