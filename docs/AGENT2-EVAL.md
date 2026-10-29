# Doors Agent, round 3 (lane agent2): before and after

Jard, 2026-10-25: "the doors agent … feels not smart"; what a rep would pay for is "something that reveals an insight or
deep market research on a specific door that will give them an edge in their pitch" (ROUND3-SPEC.md). This is what
changed, the eval that measured it, and the honest numbers. Branch `v2-agent2`.

## What changed

1. **Model.** `AGENT_MODEL` defaults to `claude-sonnet-5-5` (was Haiku 5.5); `claude-opus-5-5` and Haiku stay one
   setting away. Opus is priced in `src/spend.js` ($5 / $25 per M, talk2's figure; third-party price lists said
   $4 / $20 on 10-25). The day's Claude cap `AGENT_USD_DAILY` is $30 (was $2); the code path is unchanged. One
   Anthropic step is 12 s (was 10). The body cap is 192 KB (was 96): the demo plan's context is 93 KB now.
2. **The data gap.** The prompt used to show the model ten short tag lines for the current and next door and only a
   name, rank and on/off-plan flag for the other 38. Now every door in CONTEXT carries its kind, popularity in words
   ("0.15 (almost unknown)"), hours by day in words, whether it is on the plan and the planner's reason when not, the
   whole Qloo crowd line, the place rows (when, the room, what it pours, what the crowd is into, music, sister doors),
   Qloo's description, menu tags, rating, neighbourhood and site, and, when Doors holds it, the enrich lane's record
   (`lib/enrich.js enrichFacts`: drink brands and kinds its crowd over-indexes on against the city's doors, age skew,
   taste tags, checked facts from its own site with the URL). The day's doors keep their talking points.
   `lib/agent-context.js` builds it (`aboutForAgent`, `insightForAgent`); the page passes the stop page's
   `enrichRecords` (talk2's loader) through `ui/agent.js`.
3. **Looser rules** (`AGENT_SYSTEM`, `src/agent.js`). Dropped: never say a rank or popularity number; say the crowd
   only when asked; never repeat Qloo's crowd words; a plan answer of at most three sentences. Kept: every door fact
   traceable to CONTEXT, a tool result, the user's notes or a page; no claim about what a door stocks or pours unless
   Doors' facts for it say so, then cited ("Qloo tags it…", "its site lists…"); plain trade words; the user's ask
   verbatim; never tell the buyer what their own room is like; never describe an individual by age, gender or origin.
   New: lead with the ONE sharpest thing about this door and what it means for the pitch; a sentence that would fit
   any bar gets cut; fewer lines when the facts are thin; an inferred gap ("a brewpub's own taps can't make an NA
   hazy IPA") is said as what to ask at the door, never as what they stock.
   The nets under the prompt moved with it: on the Claude path a backed number stands (`claimsBacked` loose: any
   number the model was shown, not only a tool's facts; `noScores` now runs for the free models only); Qloo's crowd
   words stand when the sentence says they are Qloo's; a door's name is a place, not a person ("White Tiger" used to
   lose its sentence to the about-people filter). The free models (Llama, Gemini) keep every old rule.
4. **The "Why aren't these on my plan?" ask** (WHY-VIZ-SPEC §4.5), on viz2's `lib/whyviz/thread.js threadAsk`: the
   thread panel sends `doors:ask {id, whynot: threadAsk(…), send: true}`; the Worker checks the ask and rebuilds each
   door's fix from the table by the door's own fields (`cleanWhyNot`, `whyNotFixOf`), never from the client's text;
   the prompt shows the model each door's reason and fix line; the model answers per door with the fix word for word
   and a pick; `whyNotNet` falls back to the rules' text on any fix outside the table, a door's line carrying another
   door's fix, or a missing door; the rules path (`agent-rules.js whyNotAnswer`) composes `threadAnswer`'s text word
   for word (test/agent2.test.mjs holds the two equal on the demo). The reply's `whynot` carries each fix's action and
   the pick for the panel's buttons.

## The eval

`scripts/dev/agent2-eval.mjs`: 15 real rep asks on the guided demo's Austin plan (Tidewell NA hazy IPA), in Jard's
four kinds (planning 3, a specific door 4, why not X 2, what to say at Y 4) plus two honesty baits (a buyer's name,
what a bar pours), through the Worker's own `/api/agent` on Anthropic. Code checks resting, dodges and empties; a second
model (Sonnet 5.5) grades each reply: actionable, dodge, invented (a specific about a named bar or person not in the
door's facts), stock_claim (asserts what the bar stocks with no cited source), tied_house, insight 1–5 (5 = a fact of
THIS door turned into an edge; 1 = would fit any bar) and trade_voice 1–5. A reply passes when it is actionable, with
no dodge, nothing invented, no stock claim, no tied-house slip, and insight ≥ 4.

The grader is a model and it drifts: the same prompt scored 7, 9 and 7 of 15 on three Sonnet runs. Two of its
"invented" calls were its own misses (a door it was not shown in KNOWN DOORS). Read the table as a direction, not a
decimal. Runs are in `scripts/dev/eval-runs/agent2-*.json`.

| Run | Model | Pass | Insight | Voice | Invented | Stock claims | Resting | $ (15 asks) | p50 / p90 ms |
|---|---|---|---|---|---|---|---|---|---|
| before | Haiku 5.5, old prompt and context | 2 / 15 | 2.8 | 2.9 | 1 | 0 | 1 | 0.08 | 5,735 / 12,228 |
| before | Sonnet 5.5, old prompt and context | 1 / 15 | 3.0 | 3.3 | 2 | 0 | 0 | 0.35 | 5,407 / 6,274 |
| after v1 | Sonnet, new context + prompt | 7 / 15 | 3.8 | 3.7 | 1 | 4 | 0 | 1.68 | 6,443 / 7,920 |
| after v2 | Sonnet, + stock-claim line fixed, hours in words | 9 / 15 | 3.6 | 3.7 | 1 | 0 | 0 | 1.61 | 6,161 / 7,775 |
| after v3 | Sonnet, final | 7 / 15 | 3.6 | 3.6 | 2 | 0 | 0 | 1.44 | 5,798 / 10,309 |
| after v3 | Opus 5.5, final | 10 / 15 | 3.7 | 3.7 | 1 | 0 | 1 (timeout) | 3.33 | 12,593 / 18,499 |
| after v3 | Haiku 5.5, final | 5 / 15 | 3.3 | 3.3 | 0 | 2 | 1 (timeout) | 0.14 | 9,892 / 12,373 |

What the before/after says: the model swap alone bought nothing (Sonnet on the old prompt: 1 of 15). The context and
the rules are the gap: Haiku with the new context and prompt goes from 2 to 5 of 15, Sonnet from 1 to 7–9, Opus to 10.
Haiku still asserts what a bar stocks twice in 15 and is slower than Sonnet on the bigger context (it reads a 70 KB
prompt per turn), so Sonnet is the floor now. After v1's four stock claims all came from one line I wrote ("a brewery that brews its own has
no NA line of its own"), which the model repeated as fact; reworded as a question to ask at the door, zero since. One
hours misread (a Friday close said as Tuesday's) came from the raw hours JSON being cut at 300 characters; hours are
now words per day.

**Sonnet or Opus.** Opus passes more (10 of 15) with the same context, but at a desk it takes 12.6 s a turn at the
median and 18.5 s at p90 against a 12 s step budget and the page's 25 s wait: one of its 15 turns timed out and the
rules answered. Sonnet answers in 6 s. Recommendation: Sonnet stays the default; Opus is one setting
(`AGENT_MODEL=claude-opus-5-5`), and switching needs the step and turn budgets raised (`ANTHROPIC_STEP_MS`,
`TURN_MS`, the page's wait in `ui/agent.js`), Jard's call.

**Where it still falls short** (the fails on the final runs): the "why not X" kind restates the plan facts correctly but
the grader wants a pitch edge on top (insight 3); a drive-mode objection ("their regulars only drink what they brew")
got a usable line with nothing door-specific; one invented item per run is the grader's own miss. The enrich lane's
Qloo bake was not in yet when these ran (demo-tier site facts only), so the insight lines that the prompt leads with
were mostly absent: the numbers should move once `public/data/enrich/austin.json` holds the Qloo records.

## Verified

- `npm test`: 1230 pass (test/agent2.test.mjs covers the context, the rules parity with `threadAnswer`, the Worker's
  fix rebuild, the model-path net, the loose cleaners).
- `scripts/agent2-cdp.mjs` on the real page through the dev server and the live Sonnet path, at 1400 and 390: a door
  ask and the §4.5 ask (the thread panel's payload dispatched as `doors:ask`), the per-door answer with the table's
  fixes and a pick, no console errors or exceptions; `screenshots/agent2/{1400,390}/`. The Qloo ledger did not grow.
- Not re-run here: the proof pairs (`scripts/proof-freeze.sh`, `docs/PROOF.md`): the talking points are talk2's lane.
