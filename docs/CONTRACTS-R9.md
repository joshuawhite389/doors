# Owner review 9: interface contracts

The shared seams between the R9 jobs. Each section has an owner; change a section by asking its owner, and ask
the integrator to merge contract edits early. `v` bumps on any breaking change; unknown fields are ignored by readers.

| Section | Owner | Used by |
|---|---|---|
| §1 Agent API (`/api/agent`, `/api/agent/log-visit`) | the agent build | web chat, drive mode, RN app |
| §2 Tools and the actions they return | the agent build | web chat, drive mode, RN app |
| §3 Log-visit result | the agent build, shape from the drive-mode build | drive mode, RN app, chat |
| Slots, the context envelope, visit memory | the slots build: **`docs/CULTURAL-SLOTS.md`** | everyone |

## 0. Ground rules (all endpoints)

- **POST + JSON + Origin**, as `/api/route` (review6): `content-type: application/json`, an `Origin` this Worker allows
  (`src/guard.js originOk`, required), else 415 / 403. Bodies over 64 KB: 413. **Native clients** (the RN app, whose
  fetch sends no Origin) send `Origin: <the Worker's own origin>` explicitly; `originOk` is unchanged (Origin guards
  browsers from cross-site pages; the per-IP caps are the real guard).
- **The plan lives on the client.** The Worker keeps no conversation and no plan. The client sends what the agent may
  read (§1.2); the agent answers with text, sourced facts and **actions** (§2.2) the client applies through its own
  state seam (`public/ui/state.js` on the web; the same functions in the RN app). **No KV write per turn** (the free
  plan's 1,000 writes a day are for runs); the client saves what it applies (`public/lib/store.js`).
- **Code decides, the model proposes.** Every tool call the model makes is validated by code against the context the
  client sent (door ids must be on the plan, dates real and not past, text through the talking-point guard). An invalid
  call is not executed: the model gets the error back and may retry once; nothing invalid reaches `actions`.
- **The agent's expertise is the data, with sources.** No persona prompt ("act like a …"), no demographic inference.
  Every claim about a room, the crowd or the city is a `fact` carrying its `source` (§2.3); a fact with no source is
  not shown. Authority order and empty-slot behaviour: `docs/CULTURAL-SLOTS.md`.
- **Free model only.** Gemini free tier (`GEMINI_API_KEY`, `src/llm.js geminiSession`) first, Cloudflare Workers AI
  (`env.AI`, `workersAiSession`) when Gemini errors or is over quota, else **resting** (§1.4). Never a paid key.

## 1. Agent API

### 1.1 `POST /api/agent` (chat, one turn)

Request:

```jsonc
{
  "v": 1,
  "messages": [                       // the conversation so far, oldest first; the client keeps it (sessionStorage)
    { "role": "user", "text": "why is Kitty Cohen's first?" },
    { "role": "agent", "text": "…" }
  ],                                  // ≤ 12 kept (older dropped by the Worker), each text ≤ 600 chars, last is "user"
  "context": { … }                    // §1.2
}
```

Response 200:

```jsonc
{
  "v": 1,
  "reply": "Kitty Cohen's is first because …",   // plain text, ≤ 700 chars, no markdown beyond line breaks
  "facts": [ { "text": "…", "source": { … } } ],  // §2.3, what the reply rests on; the UI shows them as sources
  "actions": [ { "type": "…", … } ],             // §2.2, already validated; apply in order
  "tools": [ { "name": "explain_door", "ok": true } ],  // what ran (for the UI's "did" line and the tests)
  "by": "gemini" | "workers-ai" | "rules",       // who wrote `reply`
  "left": 42                                     // this visitor's turns left today
}
```

or the resting answer (§1.4), or 400 (bad body: `{error}`), 403, 413, 415.

### 1.2 The context the client sends

```jsonc
"context": {
  "today": "2026-10-23", "now": "14:35",        // the rep's local date and clock
  "envelopes": { "<door id>": { … } },          // CULTURAL-SLOTS §4 envelope per full door, slim (agent-context.js
                                                //   slimEnvelope: occasion, audience.contact, constraints.terms, slots[]);
                                                //   absent = empty slots (ask or neutral)
  "names": ["<rep's name>", "<contact>", …],   // ≤ 40: redacted to "the contact" before any model call (Q2); never sent on
  "avoid": ["<name>", …],                       // ≤ 800, drinker brands first: every envelope's constraints.avoid, once (never printed)
  "profile": { "brand": "Tidewell", "what": "Non-alcoholic IPA", "price": "$38/case", "ask": "…" },
                                                // the fields of public/lib/profile.js emptyProfile().pitch + brand/what
  "city": { "key": "austin", "name": "Austin" },
  "windows": [ { "date": "2026-10-23", "from": "13:00", "to": "17:00" } ],
  "day": {                                      // the selected day of the plan (plan.days[i])
    "date": "2026-10-23",
    "stops": [ { "id": "…", "eta": "14:10", "locked": false, "pinned": null, "legMin": 4, "reason": "fills a 27-min gap…" } ]
  },
  "current": "<door id>" | null,                // drive mode's current door, or the open stop
  "doors": {                                    // ≤ 40: the day's stops first, then the best of the rest of the plan;
                                                //   full records for the day's stops and `current`, the rest light
                                                //   (name, rank, N, status, outcome, popularity, affinity, crowd, captured)
    "<id>": {
      "name": "Kitty Cohen's", "rank": 1, "N": 120, "status": null, "outcome": null,
      "address": "…", "hours": "…", "popularity": 0.71, "affinity": 0.93,
      "crowd": "…", "ambience": "…", "goodFor": ["…"], "genre": "…", "price": 2,
      "sisters": ["<id>", …], "sound": { "pass": true, "artists": ["…"] },
      "talk": { "opener": "…", "questions": ["…"], "points": ["…"], "pushback": ["…"], "ask": "…" },
      "captured": "2026-10-21"                 // when Qloo was asked (the run's date)
    }
  },
  "cityData": { "citySound": ["…"], "nbhd": { "East Austin": ["…"] }, "drinker": "Athletic Brewing", "merged": false, "filter": "bars and breweries", "captured": "2026-10-08" }
}
```

`public/lib/agent-context.js agentContext({plan, dayIndex, current, city, routes, talk, envelopes, now})` builds it.
The door records are the Qloo fields the client already holds (precomputed city files or a live run's `route` +
`city`): the Worker trusts them only as the rep's own data, cuts every string to 400 chars, and never sends them to
Qloo. The agent makes **no Qloo calls** (the budget is for runs).

### 1.3 `POST /api/agent/log-visit` (drive mode's "done", one shot)

Shape proposed by the drive-mode build, adopted as is (plus `memory`, `next`):

```jsonc
// request
{ "v": 1,
  "text": "done, back Thu 3pm, liked it, hesitant about price",   // ≤ 400 chars, what the rep said or typed
  "stop": { "id": "<door id>", "name": "Kitty Cohen's", "date": "2026-10-23" },
  "now": { "date": "2026-10-23", "min": 875 },                     // minutes after midnight, local
  "windows": ["2026-10-23", "2026-10-24", "2026-10-29"],           // the plan's window dates
  "next": [ { "id": "…", "name": "…" } ],                          // optional: the day's remaining stops, in order
  "envelope": { … } }                                              // optional: the stop's CULTURAL-SLOTS §4 envelope
```

Response 200: the log-visit result (§3). Same caps as chat (one turn). Always answers: when the model is resting or
fails, the Worker runs the rules parser itself (`source: "rules"`); `{resting: true, message}` comes back only when the
visitor's own daily cap is spent, and then the client runs the same parser locally (§3.3).

### 1.4 Limits and resting

| Limit | Value | Where |
|---|---|---|
| Turns a visitor (IPv4 / IPv6 /64) | 20 per 10 min, `AGENT_DAILY` = 40 a day | isolate memory + `AGENT_LIMITER` binding when bound |
| Model calls per turn | ≤ 3 steps (tool round trips) | code |
| Model calls site-wide | `AGENT_MODEL_DAILY` = 1,200 a day per isolate, and Gemini's own free quota (429) | isolate memory |
| Input | 12 messages × 600 chars, 40 doors, 64 KB body | code |

Over a limit, or with no model answering, the answer is **200** with:

```jsonc
{ "v": 1, "resting": true, "reason": "daily" | "busy" | "model",
  "message": "The assistant is resting for today. Your plan, the stop panel and Done still work.",
  "reply": "…", "facts": [], "actions": [ … ], "by": "rules",
  "modelError": "gemini:timeout" | "gemini:429" | "gemini:503" | "workers-ai:error" | "spent" | "none",  // reason "model" only
  "retry": true }  // R9 polish: reason "model" after a transient failure only (429/503/timeout): ask again soon
```

R9 polish: `message` is "…resting for today…" only when the day's budget is spent (`reason` "daily", or "model" with
every failure a spent budget); a transient model failure says "The free models are busy right now, so Doors' own rules
answered. Ask again in a moment." (with `retry`), no model configured says so, and `reason` "busy" says "Easy there…".
After any Gemini failure Workers AI is tried next, in that turn and first for the next 5 minutes (`src/agent.js`).

Resting is never an error: the rules path still answers what code alone can (log a visit, "skip this one", "what's
next", "why is X first" from the rank line and Qloo's fields, verbatim and sourced). `/api/health` gains
`agent: {ok, model: "gemini" | "workers-ai" | "none"}`.

## 2. Tools

Declared to the model as function declarations (`src/agent.js TOOLS`), executed by code (`public/lib/agent-tools.js`,
pure, shared with the RN app and the rules path). Each returns `{ok, facts?, actions?, error?}`; the model sees the
result, the client sees only `facts` and `actions` that passed.

### 2.1 The tools

| Tool | Args | Does |
|---|---|---|
| `explain_door` | `{door_id}` | Why this room ranks where it does and what Qloo says about it: rank of N for the drinker, affinity, popularity (the reachability cap), crowd / ambience / good-for text, sister doors on the plan, the sound check. Facts only, each sourced. |
| `compare_doors` | `{door_ids: [2–3]}` | The same facts side by side (why A is before B). |
| `ask_city` | `{topic: "crowd" \| "sound" \| "neighbourhoods" \| "doors"}` | Answers about the city and its crowd from `cityData` and the doors' Qloo fields; says "Qloo doesn't say" when the data is empty, never guesses. |
| `replan` | `{skip?: [door_id], end_by?: "HH:MM", start_now?: bool, max_doors?: 1–20, lock?: [door_id], add?: [door_id], day?: "YYYY-MM-DD", move?: [{door_id, day: "YYYY-MM-DD"}]}` | Proposes a re-plan; the client runs its own planner (`replan` action). |
| `edit_talking_points` | `{door_id, section: "opener" \| "questions" \| "points" \| "pushback" \| "ask", op: "replace" \| "add" \| "remove", index?: int, text?: string}` | Edits one line of a door's talking points. `text` must pass `talk-model.js guardTalkLine` rules (length, banned words, no artist names, nothing stated about what the room stocks). |
| `log_visit` | `{door_id, result: "interested" \| "followup" \| "someone" \| "no", follow_up_date?: "YYYY-MM-DD", follow_up_time?: "HH:MM", who?: string, note?: string, said?: string, objection?: string, contact?: string, next?: string}` | Logs what happened at a door (§3). |
| `save_note` | `{door_id, text}` | Door notes (2026-10-23, `lib/door-notes.js`): keeps something the rep said that matters later ("the manager is Priya, back Thursdays", "they want samples") as an `S4.note` slot record, in the rep's own words (≥ ⅔ of its words in the rep's message; a redacted name given back), never about a person's age/gender/origin (`slots.PERSON`), once per door. Notes never expire and never feed the talking points. The model decides what is worth a note; when it notes nothing, an explicit "note that…" is saved by code and a fact for later comes back as `offerNote: {id, name, text}` (the panel's "Save as a note"). A logged visit's note is also a door note. `remember` with `field: "note"` is the same call. |
| `remember` | `{slot, field, value, door_id?}` | The rep states or corrects a fact ("they're a cocktail bar, not a pub"; "the buyer is Sam"). Writes a slot with source `corrected` or `stated` per `docs/CULTURAL-SLOTS.md`; the slot names and fields are that doc's. |

Validation (code, before anything runs): `door_id` ∈ `context.doors` (or `stop.id`); dates `YYYY-MM-DD`, not before
`today`, ≤ 60 days ahead; times `HH:MM` 24 h; `result` from `lib/outcome.js RESULTS`; free text ≤ 500 chars, stripped
of markup; `remember` is checked against CULTURAL-SLOTS §3.1 `AGENT_WRITABLE` (`corrected` only on the rep's explicit instruction that turn, else `stated`).

### 2.2 Actions (what the client applies)

```jsonc
{ "type": "status",  "id": "<door>", "status": "visited" | "talked" | "notfit" | null }      // state.setStatus
{ "type": "outcome", "id": "<door>", "outcome": { …lib/outcome.js makeOutcome…, "followUpTime"?: "HH:MM" } } // state.setOutcome
{ "type": "replan",  "skip": [], "endBy": "16:30" | null, "startNow": false, "maxDoors": null, "lock": [], "add": [], "day": "2026-10-23" | null, "move"?: [{ "id": "…", "date": "2026-10-27" }] }
{ "type": "talk",    "id": "<door>", "section": "questions", "op": "replace", "index": 1, "text": "…", "by": "rep" | "model" }
{ "type": "slot",    "id": "<door>" | "*", "record": { … } }   // (visit memory is slot records too: one action each)
{ "type": "open",    "id": "<door>" }                                   // show this stop (drive mode: make it current)
```

Rules: actions come in the order to apply them; a client that can't apply one (`state.can(name)` false, an older RN
build) skips it and says so in the chat; every applied batch is one Undo. `talk` edits are stored per door as the
rep's own lines (they beat the template and the model's lines for that door; `by: "model"` when the agent rewrote a
line, `by: "rep"` when the rep dictated it).

### 2.3 A fact and its source

```jsonc
{ "text": "Qloo ranks it 1 of 120 bars and restaurants in Austin for Athletic Brewing drinkers.",
  "source": { "kind": "qloo" | "corrected" | "stated" | "observed" | "inferred" | "default" | "plan",   // CULTURAL-SLOTS
                                                // sources, plus "plan": Doors' own planner (the day's order, drive times)
              "field": "order" | "rank" | "affinity" | "popularity" | "crowd" | "ambience" | "goodFor" | "sisters" | "sound" | "citySound" | "outcome" | "<slot>",
              "door": "<id>" | null,
              "captured": "2026-10-21" | null,          // when Qloo was asked
              "label": "Qloo, customer demographics" }  // what the UI prints
}
```

Qloo's text is quoted, not reworded, when shown as a fact. `inferred` facts (the model's own reading) are labelled so in
the UI and never outrank a `qloo` or rep fact (authority order: CULTURAL-SLOTS).

## 3. Log-visit result

### 3.1 Shape

```jsonc
{ "v": 1, "ok": true,
  "source": "model" | "rules",
  "visit": {
    "status": "visited" | "talked" | "notfit",
    "outcome": { "result": "interested" | "followup" | "someone" | "no",
                 "followUp"?: "YYYY-MM-DD", "followUpTime"?: "HH:MM", "who"?: "Sam", "note"?: "hesitant about price",
                 "at": "2026-10-23T14:35" }
  },
  "memory": [ { …slot record… } ],  // visit memory: CULTURAL-SLOTS.md §3 records (S4 contact/objection/said/next/carry,
                            //   source "stated", by "agent:<model>" | "code", confirmed false), stored in state.slots[door]
  "say": "Logged Kitty Cohen's: liked it, back Thursday Oct 29 at 3 PM. Next: Lazarus Brewing.",  // one sentence, read aloud
  "next": { "id": "…", "name": "Lazarus Brewing" } | null,   // first of request.next not done, when sent
  "actions": [ status, outcome, slot… ]                    // the same as `visit`/`memory`, as §2.2 actions (chat uses these)
}
```

`{ "ok": false, "error": "…", "ask": "Which day should you come back?" }` when the text can't be read safely (a day
named that isn't one, no result at all): the client asks the rep the `ask` question (spoken in drive mode) and sends
the answer as `text` again. `{resting: true, message}`: §1.3.

### 3.2 Mapping

- `status`: `notfit` when result is `no` and the rep says they're not a fit / won't carry; `talked` only when the rep
  says they'd already talked to them before; else `visited` (a follow-up or interested door is visited).
- `followUp`: a weekday name means the next such day after `now.date` ("Thu" on Thu = next week's); "tomorrow", "next
  week" (= the next window date ≥ 7 days on), an explicit date. A date not in `windows` is kept (the planner pins it and
  says so: `outcome.js followUpPlace`). `result: "followup"` whenever a come-back date or "come back" is said, unless
  the rep says interested *and* a date: then `interested` with `followUp`.
- `followUpTime`: "3", "3pm", "15:00", "after lunch" → none (not a time). An hour 1–7 with no am/pm reads as pm.
- `note`: the rep's words that aren't the date/time/result, trimmed; never invented.
- `who`: a name after "talked to", "spoke with", "manager is".

### 3.3 The rules parser

`public/lib/visit-parse.js parseVisit(text, {stop, now, windows})` → the §3.1 shape with `source: "rules"`, pure, no
model. The Worker uses it when resting and as the judge of the model's call (a model `log_visit` whose date differs
from what the parser read from an explicit day word is rejected and the parser's wins). Drive mode and the RN app use
the same module offline (the drive-mode build's `drive-parse.js` folds into it, or re-exports it).

## 4. Status of this contract

- v1, 2026-10-22. Built on branch `v2-agent` (endpoint, tools, parser, stub-LLM tests).
- Slots: `docs/CULTURAL-SLOTS.md` (v2-slots 40f103e) §3 record, §3.1 AGENT_WRITABLE, §4 envelope, §5 visit memory;
  code from `public/lib/slots.js`. Contact names are redacted (`slots.redact`) before any model
  call; replies pass `slots.checkReply`.

## 5. The web chat panel (for the guided demo and drive mode)

`public/ui/agent.js`. DOM hooks, stable from v1:

| Hook | What |
|---|---|
| `button[data-agent="open"]` | opens the panel (on the plan view header) |
| `#agentPanel` | the panel; `hidden` when closed; `data-state="idle" \| "thinking" \| "resting"` |
| `#agentInput` (textarea), `button[data-agent="send"]` | the rep's message and Send (Enter sends) |
| `#agentLog` | the conversation; each turn is `.agent-msg[data-role="user" \| "agent"]`, agent turns carry `data-by="gemini" \| "workers-ai" \| "rules" \| "demo"` |
| `.agent-msg .agent-facts li[data-kind][data-field]` | the facts under a reply, one per source (§2.3); `.agent-src` is the printed label |
| `.agent-msg .agent-did` | the applied-action line ("Changed the opener for Nomadic Beerworks · Undo"); `button[data-agent="undo"]` |

Seams:

- `setTransport(fn)` (export of `public/ui/agent.js`): `fn(path, body) → Promise<response JSON>` replaces `fetch` for
  `/api/agent` and `/api/agent/log-visit`. The guided demo sets it to a recorded reply or to the rules path; reset with
  `setTransport(null)`.
- `answerByRules(messages, context)` (`public/lib/agent-rules.js`): the rules path, pure, **no fetch, no DOM**: runs
  client-side. It answers "why is X first/ranked", "what does Qloo say about X", "what's next", "skip X", "shorter
  opener" (the template opener's question alone) and log-visit text, in the §1.1 response shape with `by: "rules"`.
  `public/lib/agent-tools.js` (`explain_door` and the rest) is pure the same way.
- `sendAgent(text)` (export): types and sends as the rep would (the demo's "ask" step).
- Window event `doors:agent-reply` `{reply, facts, actions, by}` after each answer is shown and its actions applied.
- Recorded replies: `test/fixtures/agent/*.json`, each `{request, response}` from a real model turn (by `gemini`),
  replayable through `setTransport`; first two: `why-first.json`, `shorter-opener.json`.
