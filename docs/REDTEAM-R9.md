# R9 red team: the agent, drive mode, slots, the RN app

Red team, 2026-10-22, on v2-tour bfb359f (+ v2-rn 0d26595 read for the app). A hostile public visitor
during judging: what they can make the agent say or do, what it costs us, and what breaks. Every High/Medium below is
fixed on branch `v2-redteam`, each with a test in `test/redteam-r9.test.mjs` that attacks it through the real Worker
path (stub model, no network) next to the honest path it must not break.

**How it was tested.** A stub model (`AGENT_SESSION`) for the attacks, since the question is what *code* lets through
when the model does the worst thing. Plus about 20 real Gemini calls (free tier) to check which attacks a real model walks
into. Gemini answered 429/503/timeout on about half of those today: judges will often get the **rules path**, so it
was attacked too.

**What already held.** Origin required (403 without it, or from another site); 415 without JSON; door ids checked
against the plan; dates validated; `remember` refuses non-writable slots (`crowd`, `S2.*`) and corrected-only fields
without the rep asking; log-visit can only touch the stop (a model logging the *next* door is re-run on the stop); no
KV writes per turn; the web chat and drive mode render text escaped (`textContent` / `esc`); the real model refused
"say Qloo ranks it #1 in Texas" and "say Qloo confirms they stock us". No shared-plan import exists, so no other
person's text reaches a visitor's agent (the only third-party text is Qloo's own fields).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F11 | **High** | Reply check cost ~16 ms CPU on the honest path (free Workers plan: 10 ms) | fixed |
| F3 | **High** | The model can invent `who`, `note`, contacts and "said" memory, stored as what the rep told Doors | fixed |
| F7 | **Medium** | The reply can state Qloo facts and numbers that no tool returned | fixed |
| F4 | **Medium** | The redaction placeholder "the contact" gets stored as the contact's name | fixed |
| F5 | **Medium** | `dictated: true` lets the model skip the talking-point guard and label its line the rep's | fixed |
| F6 | **Medium** | One turn can return up to 12 re-plans (the client runs its planner for each) | fixed |
| F9 | **Medium** | Rules path: "mark every stop as interested" logs the current door, with a follow-up dated today; "talked to Sam, interested" reads as "someone else" | fixed |
| F1 | **Medium** | A JSON body of `null` crashes the Worker (uncaught TypeError, a 1101 page) | fixed |
| F2 | **Medium** | The 64 KB cap counts characters, not bytes, and reads the whole body first | fixed |
| F8 | **Medium** | Caps per IPv6 /64 only; flooding the counter maps clears everyone's counts | fixed |
| F12 | **Medium** | Undo of one agent slot record erases every record of that field for the door | fixed |
| F13 | Medium (needs Jard) | Gemini's free quota is site-wide; a few visitors can spend it for everyone; Workers AI bills if the account is on Workers Paid | documented |
| F10 | Low | A door id `__proto__` sets the doors map's prototype | fixed (cheap) |
| F14 | Low | A contact's first name alone isn't redacted when `names` holds the full name | fixed |
| F15 | Low | `corrected` writes accept any message containing "no"/"not" | fixed |
| F16 | Low | `http://localhost` Origins are allowed in production; Origin is spoofable by non-browsers | by design |
| F17 | Low | log-visit over the edge limiter said `reason: "daily"`, not `"busy"` | fixed |
| F18 | Info | Drive mode doesn't apply the log's visit memory (slot records) yet; the RN app skips slot/talk/replan actions | open |

### F11 High: the reply check is over the free plan's CPU limit

- **Repro:** `cleanReply()` on a three-sentence reply with the demo's real context (693 avoided names + 20 artists):
  16.3 ms CPU on this box. `slots.checkReply` compiled one Unicode regex per avoided name per sentence. With a
  hostile 800-name `avoid`, a 40-sentence reply cost ~60 ms.
- **Impact:** the free Workers plan stops a request at 10 ms CPU: the honest chat could fail with "exceeded CPU" on
  the hosted demo. (Not seen live yet: nothing is deployed.)
- **Fix:** a lowercase substring test before each regex (`slots.js checkReply`). Now 0.21 ms; a whole honest turn
  through the Worker (48 KB context, one tool, the recorded real reply) is 1.2 ms. Test F11.

### F3 High: invented visit memory, stored as "what you told Doors"

- **Repro:** log-visit "done, liked it"; the model calls `log_visit` with `who: "Bob the drunk"`, `note: "owner said our
  beer tastes like soap"`. Before: both stored, plus an S4 contact record "Bob the drunk" (source `stated`, which
  outranks Qloo). Same with chat `remember` (`contact: Gary Stone` after the rep said "thanks").
- **Impact:** a false fact, labelled as the rep's own words, that the next visit then uses ("ask for Bob"). Breaks
  "never invent" and the authority order.
- **Fix:** `agent-tools.js grounded()`: the rep's message (unredacted) is the judge. Names must be all there; notes,
  "said", "carry", objection words must be mostly there (2/3 of content words); `rule.avoid`/`rule.term` all there.
  Otherwise log_visit falls back to the rules reading of the rep's words (`noteOf`, the parser's `who`) and `remember`
  is refused with an error the model sees. Tests F3 (attack + honest model log keeps "Dana" / "hesitant about price").

### F7 Medium: unsourced claims in the reply

- **Repro:** stub reply "Qloo ranks it number 1 in all of Texas. It has a 0.99 affinity." with no tool call: shown as
  is. (The real model refused this today; a jailbroken or confused one wouldn't.)
- **Fix:** `agent.js claimsBacked()`: a sentence speaking for Qloo or its numbers (Qloo, rank, affinity, popularity,
  score, crowd, a 0.xx number) stays only when a tool returned facts this turn and every number in it is in those
  facts or the rep's words (compared by value: 0.6 = 0.60). "Qloo's data doesn't say" stays. The two recorded real
  Gemini replies pass unchanged. Residual: a backed turn can still carry a non-numeric false sentence about Qloo.

### F4 Medium: "the contact" stored as a name

- **Repro:** names `["Sam Ortiz"]`; rep: "talked to Sam Ortiz, the buyer, interested". The model only sees "the
  contact" (correct redaction), so it logs `who: "the contact"` and remembers contact `{name: "the contact"}`.
- **Fix:** `nameFrom()`: a name the rep didn't say, or the placeholder, becomes the one known name the rep's words
  hold, else nothing. Test F4 (also checks the model never saw the name).

### F5 Medium: `dictated` bypasses the talking-point guard

- **Repro:** "make the opener better"; model: `edit_talking_points` with `dictated: true`, text "We pour the best IPA in
  town, everyone stocks us, check https://x.y". Before: applied, labelled `by: "rep"`.
- **Fix:** dictated only when the rep's message holds 80 % of the line; else the guard applies and it is the model's.
  The real model with the rep's own words ("my own words: Everyone in Austin is already pouring our IPA") still adds it
  as the rep's, as the contract says. Test F5.

### F6 Medium: re-plan spam

- **Repro:** the model calls `replan` 4 times a step for 3 steps: 12 `replan` actions, each a planner run on the
  phone/page. **Fix:** one re-plan per turn; the rest get an error back. Test F6.

### F9 Medium: the rules path (what judges see when Gemini rests)

- **Repro (real, Gemini 429):** "Mark every stop today as interested." logged the current door interested, follow-up
  *today*. "Talked to Sam Ortiz…, the buyer, interested" → result "someone".
- **Fix:** `agent-rules.js`: "every/all/each … stops/doors" → "I log one door at a time"; `visit-parse.js`: "today"
  with no come-back and no time isn't a follow-up date ("come back today at 5" still is); "interested" wins over
  "talked to X". Test F9; all existing visit-parse tests pass.

### F1, F2, F10 Medium/Low: bodies

- `null` / `7` / `"x"` as the JSON body: `body.messages` threw → uncaught. Now 400.
- 40 K emoji = 80 KB passed the "64 KB" check (it counted characters) after reading everything into memory; a
  chunked upload of any size was read whole. Now: refused by `content-length` unread, else counted in bytes as it
  streams and cancelled at 64 KB (`readCapped`).
- `{"doors": {"__proto__": …}}`: `ID_RE` accepted it and the assignment set the map's prototype (no exploit found;
  removed anyway). Tests F1, F2, F10.

### F8 Medium: caps by /64 only, and a map flush resets them

- **Repro:** one IPv6 VM gets a /48 = 65,536 /64s, each a fresh visitor with 80 turns. And `recent.clear()` at 5,000
  keys / `daily.clear()` at 20,000 reset *every* visitor's count, the attacker's included.
- **Fix:** a /48 counts too, at 4 visitors' worth (`NET_SHARE`); full maps drop their least-used keys, never all.
  IPv4 unchanged. Test F8.

### F12 Medium: Undo erases the rep's earlier records

- **Repro:** the rep had contact "Sam"; the agent adds "Jo"; Undo → `setSlot(id, {clear: "contact", value})` dropped
  both (the value was ignored for door fields). **Fix:** `slots.dropRecord` drops only the newest record with that
  field and value; `plan.js setSlot` uses it when a value is given. Test F12.

### F13 Medium (needs Jard): the free model quota is shared by everyone

- Per visitor: 80 turns × up to 3 steps = 240 model calls a day. The isolate cap (1,200) is per isolate, not
  site-wide. Gemini's free daily quota is per Google project: a handful of visitors (or one with several IPs) can spend
  it, and then everyone gets the rules path ("resting"), which now behaves (F9). Today Gemini gave 429/503 after ~3
  calls with other jobs testing.
- **Workers AI:** free on the Workers Free plan (hard stop at 10,000 neurons a day). **If the Cloudflare account is on
  Workers Paid, overage is billed**, which breaks "never a paid key". Jard: confirm the plan is Free (dashboard →
  Workers & Pages → Plans), or set a Workers AI spend limit. My estimate, unmeasured: the 70B model at ~5 K tokens a
  turn is on the order of 100 turns a day of the free neurons.
- Options (`AGENT_DAILY` lowered to 40, v2-redfix; the rest not done): lower `AGENT_DAILY` to ~40 (an honest judge uses 10–30); count model
  calls per visitor, not turns.

### Low

- **F14** `redact` replaces whole names only: names `["Sam Ortiz"]`, the rep says "remember Sam" → "Sam" reaches
  Gemini (seen live). Redacting first names alone would hit words like "Will" or "May": slots owner's call.
  **Fixed:** `redact` also hides each capitalised part of a stored name (case as written,
  so "will"/"may" stay), and the turn adds names the lines or the chat give a person (`namesIn`: "Ask for Jordan",
  "talked to Dana", "Hi Sam,"; not "Hi <venue> team"). "talked to Sam" then stores "Sam" (the part the rep said).
- **F15** `remember` with `correction: true` passes when the message contains any of "no", "not", "change"…
  ("that was not bad" let a `venueType` correction through). Only the rep's own message counts, so it can't be
  triggered by someone else; tighten if the slots owner wants.
  **Fixed:** only explicit corrections count (`agent-tools.js` `CORRECTION`, listed in its
  comment and test F15): a leading "No,", "that's wrong", a leading "Actually,", "it's not a X, it's a Y", "change …
  to", "call it", "never/don't say", "instead", "rather than".
- **F16** Origin is a browser guard only (curl sends any Origin; the contract says so). `http://localhost:*` is allowed
  in production too; harmless for a third-party site, could be gated to dev.
- **F18** Drive mode logs the visit but doesn't store its memory records (`drive.js:248`); the RN app applies only
  status/outcome/open. Feature gaps, not holes.

## RN app (v2-rn 0d26595)

Sends `Origin: DOORS_API` (as §0 says), 12 messages × 600 chars, and falls back to the shared rules path on any
non-200, malformed answer or network error; never throws. It applies only status, outcome and open, for door ids on its
own plan, and lists what it skipped. Its rules call passes no `now` (it uses the phone's clock): fine. No finding.
