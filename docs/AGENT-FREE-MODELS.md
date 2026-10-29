# The chat agent on free models (R9)

What the agent runs on when nobody pays: Gemini's free tier, Cloudflare Workers AI's free 10,000 neurons a day, then
the rules ("resting"). Measured through the Worker's own `/api/agent` and `/api/agent/log-visit` path, on the guided
demo's Austin plan, with `scripts/dev/agent-workers-ai.mjs` (Workers AI over REST: `scripts/dev/workers-ai-rest.mjs`).
~150 Workers AI calls in all.

## Chain (src/agent.js `sessions`)

1. **Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast`** while this isolate's neurons today < 6,000
   (`AGENT_NEURONS_70B`) and the visitor has had ≤ 12 turns today (`AGENT_70B_PER_VISITOR`).
2. **Workers AI `@cf/meta/llama-3.1-8b-instruct-fp8-fast`** up to 8,500 neurons (`AGENT_NEURONS_DAILY`).
3. **Gemini free** (`gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite`), 6 s a step
   (`GEMINI_STEP_MS`). A model that failed is skipped for 5 min; a 429 that says the day's quota is used ("PerDay",
   with Google's `retryDelay`) skips it until Google's reset.
4. **Rules**, labelled resting (`modelError` says why: `workers-ai:neurons`, `70b:spent`, `gemini-…:429`).

The response carries `model` ("Cloudflare Workers AI (Llama 3.3 70B)", "Google Gemini (3.5 flash)"); the panel's badge
and its footer line ("This answer: …", or "This answer is from Doors' own rules: no model was used.") show it.

## Primary model (live check D)

The live check met Gemini first and it failed 4 of 4 asks (3 timeouts at 8 s, one 503), so judges got Workers AI after
up to 9 s of waiting, under a footer that said Gemini. Measured again with the 10 asks of
`scripts/dev/agent-workers-ai.mjs` (8 chat turns + 2 log-visits) on the fixed agent:

| Model | Right | Turn time | Why it fails |
|---|---|---|---|
| gemini-3.1-flash-lite | 1/10 | 0.5–10.7 s | 503 ×6, 8 s timeout ×3; a bare "Say ok" took 34.5 s |
| gemini-3.5-flash | 0/10 | — | 429 every ask, paced at 20 s too: `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, **limit 20** |
| gemini-3-flash-preview | 0/10 | — | the same per-day 429, limit 20 |
| Workers AI llama-3.3-70b | **9/10** | 1.0–10.0 s, avg ~6 s | `remember` a contact: refused as "the rep didn't say that" ×3 (likely the name redaction: the model sees "the contact"; not checked) |
| Workers AI llama-3.1-8b | 6/10 | 0.6–2.6 s | replan args, junk `remember` on "thanks!", log-visit result |

20 requests a day a model is 5–10 chat turns (a turn is 2–4 requests), for every judge together. So Workers AI is
first (~25 turns a day on 70b, ~65 more on 8b), and Gemini is the backup for the turns after that.

Cloudflare's own "daily free allocation used" error (4006) ends Workers AI for the day too (the in-memory count is per
isolate; that error is the account-wide backstop). Day = UTC, as Cloudflare resets at 00:00 UTC.

## Evidence

| Model (2026-10-22) | Right | Neurons / chat turn | Per log-visit | Turn time | Notes |
|---|---|---|---|---|---|
| Gemini free chain | 3/10 | 0 | — | 2–4 s | first 3 turns answered, then 503/429 on all three models, one 8 s timeout |
| Llama 3.3 70b fp8-fast | 10/10, then 3/3 | 83–350, avg ~230 | 93–140 | 1–12.6 s (2–5 s a step) | 1 step timeout (> 8 s) in ~20 turns |
| Llama 3.1 8b fp8-fast | 7/10, then 4/5 | 28–47, avg ~37 | 10–30 | 0.8–3 s | weaker: stores junk memory on "thanks!", sometimes chains extra tools |
| Qwen3 30b-a3b fp8 | 5/10 | ~35 | ~19 | 1.6–7.9 s | thinking used the whole 512-token budget, XML-ish replies: **killed** |

"Right" = the expected tool ran OK and its action is in the answer (finish-by: a replan with end 16:30 skipping the
next stop; log-visit: the right result and follow-up). Prices: developers.cloudflare.com/workers-ai/platform/pricing
(updated 2026-10-20): 70b 26,668 / 204,805 neurons per M input/output tokens; 8b fp8-fast 4,119 / 34,868; free
10,000 neurons/day, reset 00:00 UTC. A chat turn is 2–3 model steps of ~3,100 input tokens each, so input dominates.

**Capacity a day:** ~25 turns on 70b (6,000 / ~240), then ~65 on 8b (2,500 / ~37), then rules: ~90 model turns, 15%
under 10,000. Plus every turn Gemini answers.

## What was broken and is fixed

- **Workers AI's answer shape changed** to OpenAI's (`choices[0].message.tool_calls`, `usage`); the session read only
  the old `{response, tool_calls}` and so saw no text and no calls. `readWorkersAi` (src/llm.js) reads both, plus a call
  written as JSON or `<function=…>` in the text (known tools only), and strips `<think>`.
- **UUID door ids** were a third of the prompt and easy to miscopy: the model now sees `d1, d2…` (the day's order),
  mapped back before a tool runs (a real id still works). Prompt −27%, neurons per 70b turn 289 → ~230.
- **Llama 8b's argument habits** (`"true"`, `"0"`, `"[]"`, `"None"` in every optional arg): `coerceArgs` types them
  from the schema and drops placeholders. 8b's replan went from 0/3 to working.
- **Repeated changes:** 70b called replan / edit_talking_points twice per turn (two actions applied). One change of a
  kind per turn; the repeat gets "already done; now answer the rep".
- **Replies narrating the call** ("The replan function is called with skip=[…]") or showing ids are dropped for the
  fallback line.
- **log-visit judge** (public/lib/agent-tools.js): yes/no and not-a-fit are the rules parser's call when it reads one
  (8b logged "liked it, back Thu" as no; 70b logged "not a fit" as a plain visit); a `who` the rep never said is dropped
  (8b put the door's name there). The rules parser was right on all four sample visits.
- **remember contact:** a bare name (+ role beside it) becomes `{name, role}`.
- `max_tokens` 2048 → 512 (a turn's reply is ≤ 3 sentences; caps a runaway step at ~105 neurons on 70b).

## Not verified

- The deployed `env.AI` binding's answer shape (REST returned the OpenAI shape; the parser reads both).
- Behaviour across many isolates (each counts its own neurons; the 4006 error is the backstop).
- 8b on more phrasings than the eight scripted turns.

## Run it

`node scripts/dev/agent-workers-ai.mjs 70b 8b [--save dir]` (TURNS=a,b to pick; DEBUG=1 prints the calls; `gemini`
runs the Gemini chain instead, `gemini:<model>` one model; PACE=ms between asks). The live check's two-turn failure:
`node scripts/dev/agent-multiturn.mjs 70b`. Dev server with Workers AI: `NO_MODEL=1 WORKERS_AI=1 node scripts/dev.mjs <port>`.
