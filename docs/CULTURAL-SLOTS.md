# Cultural slots — Doors R9 audit and build spec

Owner review 9 (2026-10-22), per the Cultural Slot Framework (Obsidian `2-Areas/Gigbot/Cultural Slot Framework
audit-and-build prompt.md`, §9 deliverables). **This file is public** (the method story for judges): it holds no Qloo ranks, ids, tags or quoted Qloo text, only
venue names. Keep it that way. This file is the contract the other R9
jobs build on (chat agent, drive mode, RN app): **§3 (slot record), §4 (context envelope) and §5 (visit memory) are
interfaces**; change them only through this file.

**Audience this is built and tested for:** reps and founders of emerging US drink brands, walking into independent bars,
breweries, restaurants and cafés in the four held cities (Austin, Boise, Chicago, Omaha), in English. Nothing here is
claimed beyond that. "Culture" in Doors means **the room's norms and the people in it** (who buys, when they're busy,
how a buyer expects to be approached, what this rep already heard from this buyer), not nationality or identity.

## 1. Decision-point inventory

Every point where Doors makes a choice or emits something a person receives. **E** = Enforced (code, schema or validator
uses it), **A** = Advisory (prompt text only), **M** = Missing (no cultural input). "Slot" = the framework slot it
belongs to. Where a point is M and no cultural variation changes the decision, it is marked *not a slot* (§6 rule:
don't add a slot where no decision varies).

| # | Decision point (code) | Class | Slot | What decides it today | Gap |
|---|---|---|---|---|---|
| D1 | Drinker resolution (`worker.runRoute`, `drinks.pickBrand`) | E | S2 | name match ≥ 2, never a brand by another name | — |
| D2 | Which rooms, in what order (`pool.js`, Qloo affinity lists) | E | S2 | Qloo taste ranking applied by code; merge round-robin | Visit memory never moves a room ("they only stock local" → similar rooms unchanged). Low visibility; **not built** |
| D3 | Default Rooms to pitch (`profile.defaultRooms`) | E | S1 | product kind keyword map | — |
| D4 | Excluded doors (`pool.effectiveStatuses`) | E | S4 | visited / talked / not a fit | — |
| D5 | Day order and routing (`schedule.js`) | M | — | hours, rank vs. drive time | *not a slot*: no cultural variation changes a road |
| D6 | Who to ask for (`talk.venueType`) | E | S1 | venue type from Qloo genre | Ignores the contact the rep already met (`outcome.who`) |
| D7 | Arrival timing advice (`talk.arrivalAdvice`) | E (hours) / M (norms) | S1/S3 | the room's own hours + **one global service clock** (lunch 11:30–1:30, dinner 5:30) | A café's rush is 7–9 am; a taproom has no lunch service. Same advice for every type |
| D8 | Opener (`talk.crowdPhrase`, `talk-model.guardTalkLine`; **since 2026-10-24 the opener never quotes the crowd**: the crowd text only picks the daytime and sports angles, `culture.angleFor`) | E | S2/S3 | Qloo crowd field, guarded (≤ 18 words, source field present, no generic crowd, no quantifier the source lacks) | **First-visit only**: a return visit re-introduces the room's crowd to the people who work there |
| D9 | Questions to ask (`talk.talkPoints` §3) | E | S1 | product kind × venue type | Return visit re-asks what the rep already logged |
| D10 | Points to make, facts (`facts.json` allowlist, NA rotation) | E | S2 | kind, NA, venue type | — |
| D11 | Likely pushback (`talk.talkPoints` §5) | E | S2 | kind × type, drinks-like brand kind | **Ignores the objection this buyer actually gave** ("hesitant about price") |
| D12 | The ask | E | S1 | profile ask > kind default > neutral ask | Return visit doesn't move the ask on (interested → confirm the order) |
| D13 | Drafted note (`note.draftNote`) | E (guards) / M (occasion, channel) | S3 | one register, one length | Same 6-paragraph body for Email **and Text**; a return visit re-introduces the rep; never uses the contact's name |
| D14 | Note edits (`ui/stop.js` copy/email/text) | M | S6 | edits live in the textarea only | **Lost on close**: the correction doesn't persist |
| D15 | Talking-point corrections | M | S6 | none exist | No way to say "never say X" / "call it alcohol-free, not NA" |
| D16 | Model-drafted lines (offline Gemini, `talk-model`) | E | S3 | guard at store time and at show time | — |
| D17 | Room sound / artists (`guardSound`, `cityArtists` avoid list) | E | S2 | plausibility guard; artists never printed in lines | — |
| D18 | Why drawer age skew, crowd terms (`insights.ageSkew`, `roominsight`) | E (display) | S2 | Qloo's aggregate age re-ranks of the room | Descriptive only. Risk: the agent turns it into a spoken claim about people ("your regulars are young"). §7.3 tests it |
| D19 | Outcome sheet defaults (`outcome.defaultFollowUp`) | E | — | next window | *not a slot* |
| D20 | **Chat agent replies** (R9 new) | M (would be A) | S5/S3 | — | Red flag if built as a persona prompt with Qloo text pasted in. Needs the envelope (§4) and code-validated tool calls |
| D21 | **Log-visit parse** (R9 new: "done, back Thu 3, liked it, hesitant about price") | M | S4/S6 | — | Free text → stored facts. Must store as `stated` with the rep's own words, never as inferred traits of the buyer |
| D22 | **Drive mode current door** (R9 new) | — | consumer | reads `stopModel` | Inherits D8–D13; must show the return-visit version |
| D23 | Export / call sheet (`lib/export.js`) | E | consumer | `stopModel` | Must use the rep's edited note (D14) |
| D24 | NA / soft-drink framing (N2 kinds) | E | S1 | `productKind` | — |
| D25 | Rooms that pour you line (N3) | E | S4 | the rep's own rooms (stated) | — |

**Read of the audit.** Doors is already strong where the framework usually finds rot: Qloo data enters as a *ranking
applied by code* (S2), never as "use these" prompt text; every spoken line is template-or-guarded; no persona prompts;
no demographic inference about anyone. **The gaps are all one shape: Doors treats every visit as the first visit, every
channel as email, and every edit as disposable.** It never learns from what the rep heard at the door. That is exactly
where a generic LLM baseline also fails ("that's not how people talk", "too long", "you already told me that"), and
it is the demo's own beat (Nomadic Beerworks: visit Tuesday, return Thursday).

### Ranked gaps (visibility × 1/effort)

| Rank | Gap | Points | Visible failure today | Effort | Build |
|---|---|---|---|---|---|
| 1 | **Return-visit occasion + visit memory** (S1 + S4) | D6 D8 D9 D11 D12 D13 D21 | Thursday's Nomadic card says "Looks like your regulars are …" and "Hi Nomadic team, I'm Maya from Tidewell" to people she met two days ago; the price objection she logged is nowhere | M | **yes, first** |
| 2 | **Channel register/length** (S3) | D13 | "Text" sends a 6-paragraph email as an SMS | S | yes |
| 3 | **Corrections persist and win** (S6) | D14 D15 D23 | rep fixes the note, closes the stop, the fix is gone; no "never say X" | M | yes |
| 4 | **Envelope for agent and tools** (S5) | D20 D21 D22 | (not built yet) the agent would get culture as free text | S (spec + one pure function) | yes, early: other jobs need it |
| 5 | **Venue-type timing norms** (S1) | D7 | a café at 8:10 am is told it's "before the lunch rush" | S | yes, if time |
| 6 | Visit memory reorders similar rooms (S2) | D2 | low | M | **cut** (post-freeze) |

## 2. Authority order and expiry (applies to every slot)

`corrected` (the rep edited or overrode it) > `stated` (the rep said it: outcome, visit note, profile field) >
`observed` (what the rep did: marked visited at 2:40, skipped, not a fit) > `qloo` (external data, with its capture
date) > `inferred` (a model or heuristic guessed it) > `default` (Doors' template).

- A lower level never overrides a higher one for the same `field` and scope. Within a level, newest wins.
- **Expiry** (defaults, `slots.EXPIRY_DAYS`): `stated` visit facts 60 days; the contact's name 180 days; `observed`
  90 days; `qloo` = its `captured` date + 120 days; `inferred` 14 days and never shown as fact; `corrected` never
  (until the rep removes it). Expired = ignored by `resolve()`, kept in storage for the trace.
- **`inferred` is never written about a person** (the buyer or the rep). The only inferences Doors allows are about the
  *product* (kind from "What you make") and the *room* (venue type from Qloo genre), and both are shown on the form or
  the stop where the rep can change them.
- **No identity inputs.** No slot reads a name, a city or a neighbourhood to guess anything about a person. A contact's
  name is a string the rep typed, used only to greet them.

## 3. The slot record (interface)

Stored in the saved state (`store.js`), additive: `state.slots = { "<doorId>" | "*": [record, …] }`. `"*"` = brand-wide
(S6 rules: stored once per brand in `doors.v2.rules.<brand>`, every city; Q4). `STORE_VERSION` stays 1; `normalise` defaults `slots` to `{}`. Pure helpers in `public/lib/slots.js`.

```js
{
  slot: "S4" | "S6" | "S1" | "S3",   // framework slot
  field: "contact" | "said" | "objection" | "next" | "carry" | "note.email" | "note.sms" | "rule.avoid" | "rule.term" | …,
  value: "Sam" | "price" | "…",       // string or small object, never a prose blob about a person
  source: "corrected" | "stated" | "observed" | "qloo" | "inferred" | "default",
  by: "rep" | "agent:<model>" | "code",   // who wrote it. agent-extracted rep words = source "stated", by "agent:…"
  words: "hesitant about price",      // the rep's own words it came from (stated/corrected), for the trace
  at: "2026-10-22T19:40:00Z",
  expires: "2026-12-21T19:40:00Z" | null,
  confirmed: true | false,            // agent-extracted records start false; the rep's confirm/edit sets true
}
```

`resolve(state, doorId, field, now)` → the winning live record (door scope first, then `"*"`) or `null`. `trace(record)`
→ a human line: "From your note on Tue Oct 21 ('hesitant about price')". Unconfirmed agent-extracted records **are
used** (the rep said it) but labelled "from your words, not yet confirmed" on the stop.

### 3.1 What the agent may write (the `remember` tool and log-visit validate against this list)

`slots.AGENT_WRITABLE` (code; anything else is refused):

| slot | field | source the agent writes | when | value check |
|---|---|---|---|---|
| S4 | `contact` | stated | the rep names who they talked to | ≤ 60 chars, `{name, role?}`; role ∈ owner, manager, bar manager, beverage director, GM, bartender, other |
| S4 | `objection` | stated | the rep reports pushback | `{kind ∈ OBJECTIONS \| "other", words}`, words ≤ 140 |
| S4 | `said` | stated | anything else the buyer said, verbatim | ≤ 140 chars, the rep's words |
| S4 | `next` | stated | a return date/time | a window date, `HH:MM` optional |
| S4 | `carry` | stated | what the room already has | ≤ 80 chars |
| S1 | `venueType` | corrected | "they're a cocktail bar, not a pub" | ∈ brewery, bar, restaurant, coffee |
| S6 | `rule.avoid` | corrected | "never say X" / "that's not true" | ≤ 60 chars, scope door or `"*"` |
| S6 | `rule.term` | corrected | "call it alcohol-free, not NA" | `{from, to}`, each ≤ 40 chars, scope `"*"` |
| S6 | `note.email`, `note.sms` | corrected | the rep dictates a new note | ≤ 2,000 / 320 chars, one door |

Agent-written records carry `by: "agent:<model>"`, `confirmed: false`, `words` = the rep's sentence. The agent
**never** writes `qloo`, `observed`, `inferred` or `default` records, and never a field about a person other than
`contact` (no traits, moods, ages, origins). `corrected` needs the rep's explicit instruction in that turn; otherwise
`stated`. Statuses and outcomes stay `status`/`outcome` actions (contract §2.2), not slots.

### 3.2 Plain words (judge-facing and UI copy; use these verbatim)

| source | say | authority |
|---|---|---|
| corrected | "your correction" | 1 (wins) |
| stated | "what you told Doors" | 2 |
| observed | "what you did" | 3 |
| qloo | "Qloo's data (captured <date>)" | 4 |
| inferred | "a guess" (never shown as fact) | 5 |
| default | "Doors' template" | 6 |

One line: **"Your correction beats what you told Doors, which beats what you did, which beats Qloo's data, which beats a
guess, which beats Doors' template."**

## 4. The context envelope (S5, interface)

Every agent tool call, drive-mode request and RN screen gets one envelope per door, built by code from the saved state —
never from the conversation transcript. `slots.envelope(plan, state, doorId, {channel})`:

```js
{
  v: 1,
  brandCity: "tidewell-austin",
  door: { id, name, venueType: "brewery", rank: <k>, N: <n>, rankBy: "qloo" | "doors-merged" },
  audience: { role: "taproom manager or owner", contact: { value: "Sam", source: "stated", at } | null },
  occasion: { visit: "first" | "return", lastVisit: "2026-10-21" | null, outcome: "followup" | null,
              channel: "spoken" | "email" | "sms", arrival: "lull" | "service" | "opening" | … },
  constraints: { kind: "beer", isNA: true, ask: "one case of cans in the cooler", maxWords: { spoken: 18, sms: 55 },
                 avoid: ["<artist and drinks-like brand names>", …rule.avoid], terms: { "NA": "alcohol-free" } },
  slots: [ /* the live records for this door + "*", each with source and trace */ ],
  qloo: { crowd: { text, field: "customer_demographics_description", captured } | null },
}
```

Rules for consumers (the agent job enforces these in code, tested there):
1. A tool's **arguments are validated by code** against the envelope (door id exists in the plan, dates are windows,
   result is one of `outcome.RESULTS`). The model's say-so is never enough.
2. Agent **free text that states a fact about a room or a person must cite an envelope item** (`[slot:objection]`,
   `[qloo:crowd]`); `slots.checkReply(text, envelope)` drops uncited claims about people's tastes or identity and any
   `avoid` name. No "act like a bar manager / an Austin local" system prompt: the agent's expertise is the envelope.
3. Visit notes leave the device only inside an envelope, and **contact names are replaced by "the contact"** before any
   free-tier LLM call (`slots.redact`). See open question Q2.

## 5. Visit memory (S4, interface for log-visit)

What a visit writes (from the outcome sheet today; from the agent's log-visit tool in R9). The outcome itself stays as
is (`outcome.makeOutcome`); the structured facts go to `state.slots[doorId]`:

| field | from | example value | source | used by |
|---|---|---|---|---|
| `contact` | "Talked to someone else: Sam", or "talked to Sam" in a log | `"Sam"` (+ optional role `"bar manager"`) | stated | D6 "Ask for Sam", D13 "Hi Sam" |
| `objection` | the note / log, matched to `OBJECTIONS` (price, space, local-only, own-beer-only, NA-doesn't-sell, already-carry, needs-owner) or kept as words | `{kind: "price", words: "hesitant about price"}` | stated | D11 first pushback |
| `said` | anything else they said, kept verbatim, ≤ 140 chars | `"liked it"` | stated | D8 return opener |
| `next` | follow-up date/time | `"2026-10-23 15:00"` | stated | planner pin (exists) + note |
| `carry` | "they have Athletic on draft" | `"Athletic on draft"` | stated | D9 drops the carry question |

**Extraction** (agent or code): a keyword matcher (`slots.fromNote`) runs on every outcome note, deterministic; the
agent may add records with `by: "agent:…"`, `confirmed: false`. Neither ever writes a trait of the buyer ("seems
conservative", "older crowd"). Only what was said, quoted.

## 6. Slot specs (prioritized gaps)

### S1+S4 — Return visit (gap 1)

| Field | Spec |
|---|---|
| Decision governed | Opener, who to ask for, questions, pushback order, the ask, the note's greeting and intro, for a door with a prior visit |
| Content | `occasion.visit = "return"` (door has an outcome or a past `observed` visit) + the §5 records |
| Provenance | stated (outcome sheet, log-visit), observed (marked visited) |
| Confidence / age | stated 60 d; contact 180 d. Past expiry → first-visit behaviour, with "you last visited <date>" kept |
| Scope | one door, one brand-city. Never copied to other doors |
| Consumer / enforcement | `talk.talkPoints` and `note.draftNote` take `memory` (from `slots.memoryFor`); **code** picks the return template. The model lead (D16) is not used on a return visit |
| Empty behaviour | return visit with no notes → neutral return lines ("Following up from Tuesday."), never an invented quote or name |
| Correction path | edit/delete any record on the stop ("What you logged" list); edits are `corrected` and win |
| Trace | each changed line carries `src: {slot, field, source, trace}`; the stop shows a small "from your note" tag |
| Test | §7: swap first/return, ablation `S4` off = today's output, empty, label-invariance on the contact name |

Return-visit content (template, deterministic):
- Before: "Ask for Sam (you talked on Tue Oct 21)." replaces the role line when `contact` is live.
- Opener: "Good to see you again. <`said` → 'Last time you said: “liked it.”'> Did the team get to try the samples?"
  (no crowd line: they know their own regulars).
- Questions: the carry question is dropped when `carry` is live; "Who decides" is dropped when `contact` has a role
  of buyer/owner/manager; added first: "What would make this an easy yes?".
- Pushback: the logged objection comes **first**, with a fixed reply per `OBJECTIONS` kind (price → "Start with one
  case at <price>; if it doesn't move in three weeks, we'll look at it together."), or "They said: “<words>”. Have an answer
  ready." for an unmatched one.
- Ask: outcome interested → "Confirm the first order: <ask>."; else the same ask.
- Note: "Hi Sam," / "Hi <venue> team,"; "it's <first> from <brand> again — thanks for your time on Tuesday."; no
  intro sentence, no crowd line, one line on the logged objection if any ("I've brought the price sheet you asked
  about."), the ask, sign-off. Shorter than the first-visit note by construction.

### S3 — Channel register and length (gap 2)

| Field | Spec |
|---|---|
| Decision governed | The note's length, greeting and line count per channel |
| Content | `channel: email | sms`; `constraints.maxWords.sms = 55`, ≤ 320 characters |
| Provenance | default (Doors), overridable by `corrected` `note.sms` |
| Consumer / enforcement | `note.noteFor(note, "sms")` builds the SMS from the note's parts (greeting, one-line intro, the ask, name) and **code truncates to the cap at a line boundary**; the Text button and drive mode use it |
| Empty behaviour | no first name → "– <brand>"; no brand → no sign-off |
| Correction path | rep edits the SMS text → stored `note.sms` corrected for that door |
| Trace | label: "Text version, shortened for SMS" |
| Test | swap email vs sms: sms ≤ 320 chars, ≤ 4 lines, contains the ask; email unchanged |

### S6 — Corrections (gap 3)

| Field | Spec |
|---|---|
| Decision governed | Any emitted line (note, talking points, SMS, agent replies) |
| Content | per door: `note.email` / `note.sms` (the rep's whole edited text); brand-wide `"*"`: `rule.avoid` (a phrase never to say), `rule.term` ({from, to}: "NA" → "alcohol-free") |
| Provenance | corrected |
| Expiry | none |
| Consumer / enforcement | `slots.applyRules(lines, rules)` runs **last**, in code, on every output (stopModel, export, envelope `constraints`): a line containing an avoided phrase is dropped (or the template's fallback used), terms replaced whole-word. The rep's edited note replaces the drafted one, shown as "Your version" with "Reset to draft" |
| Empty behaviour | no rules → output unchanged |
| Correction path | the stop: note edits auto-save on blur; "Don't say this" on a talking point → `rule.avoid` with that line's key phrase; Edit profile lists rules with delete |
| Trace | "Your version (edited Oct 22)"; "1 line hidden by your rule 'price'" |
| Test | correction test: edit → reload (store round-trip) → edited text shown and exported; avoid rule hides line on every door; a later Qloo/model line can't bring it back |

### S5 — Envelope (gap 4)
Spec is §4. Enforcement: `slots.envelope()` is the only way an agent tool gets door context (agent job's tests assert
it); `slots.checkReply()` validator; `slots.redact()` before any LLM call. Test: the agent job's scripted-conversation
test passes an envelope with `rule.avoid` and asserts the reply never contains it.

### S1 — Venue-type timing norms (gap 5)

| Field | Spec |
|---|---|
| Decision governed | `arrivalAdvice` text and kind |
| Content | `RUSH[venueType]`: coffee 7–9:30 am + noon–1 pm, lull 2–4 pm; restaurant (today's clock); bar/brewery: no lunch service; quiet before 4 pm, happy hour 4–6 pm, busy after 7 pm |
| Provenance | default (Doors), labelled as a rule of thumb; the room's own hours still win (open/closing logic first) |
| Empty behaviour | unknown type → today's restaurant clock |
| Test | swap venue type at 8:10 am and 5:15 pm → advice differs; the hours rules (opening/closing/wait) unchanged |

### Qloo deep data (probe, 2026-10-22): where it fits
The deep-data probe found room tag families already on every door result (zero extra calls): what the room offers to
drink, menu highlights, visit intent, time-of-day fit, ambience. Doors' trimmed venue records don't keep them yet.
Planned use, all as `qloo` records, applied by code:
- **time-of-day fit → S1 timing** (a late-night room: the advice says so), below the room's own hours.
- **drinks offered → S2 questions only** ("Do guests ask for agave spirits here?"): Qloo doesn't know what a venue
  stocks, so a tag is never a claim.
- **visit intent → S1 occasion** for who-to-ask and the opener's question, guarded like the crowd line.
Brand cross-domain tastes (TV, podcasts, destinations) and audience demographics stay **out of spoken lines**: at most a
labelled brand fact in the Why drawer, never about a person. Not built before the freeze unless B5 lands early: the
records need the trimmed venue files rebuilt from cached responses (no new calls).

### Deliberately not slotted
D5 routing, D19 follow-up default, map and animation. D2 "memory reorders similar rooms": a real S2 slot, cut for time.
**Qloo deep data**: any new Qloo signal enters as a `qloo` record with its
field name and capture date, into S2 (ranking/filter, applied by code) or as opener material only through the existing
guard (`guardTalkLine` source-field check). Nothing from it is ever pasted into an agent prompt as "use these".

## 7. Test plan (framework §7)

All automated tests are pure (no network), in `test/slots.test.mjs` (unit) and `test/slots-eval.test.mjs` (the
scenario set). Every slot can be switched off: `stopModel({…, slotsOff: ["S4", "S3", "S6", "S1t"]})` = today's
behaviour (the ablation baseline). Scenario fixtures use the real Austin data (Nomadic Beerworks, Central District
Brewing, a café, a restaurant) and the demo profile (Tidewell, NA hazy IPA).

### 7.1 Swap (context changes → output must change; same context → identical)
| # | Fixed | Swapped | Must change | Must not change |
|---|---|---|---|---|
| W1 | Nomadic Beerworks, Tidewell | first visit ↔ return visit (outcome followup, note "liked it, hesitant about price", talked to Sam) | opener (no crowd line), "Ask for Sam", pushback[0] = price, note greeting "Hi Sam", note shorter | rank line, facts, hours, ask text |
| W2 | same return visit | objection price ↔ space ↔ local-only | pushback[0] reply | everything else |
| W3 | Tidewell note at Nomadic | email ↔ sms | sms ≤ 320 chars, ≤ 4 lines, keeps the ask | email body = today's |
| W4 | 8:10 am arrival | café ↔ bar ↔ restaurant | timing advice | who-to-ask by type (already) |
| W5 | Nomadic | product NA hazy IPA ↔ sparkling water ↔ tequila | (exists, N2 kinds) questions, ask, pushback, facts | — |
| W6 | any of the above | run twice | nothing (deterministic) | — |

### 7.2 Ablation
For W1–W4: slot on vs. off. Each slot must change at least one line in its scenario (else it is decoration and is
removed), and off must equal the pre-R9 output byte for byte (proves the baseline is real).

### 7.3 Label-invariance
- L1: same return visit, contact "Sam" ↔ "Guadalupe" ↔ "Wei" ↔ "Mohammed" ↔ "Aoife": output identical after replacing
  the name token. No pronoun appears ("ask for him/her"): the name or "them" only.
- L2: same visit signals, rep first name swapped ("Maya" ↔ "DeShawn" ↔ "Priya"): identical modulo the name.
- L3: same venue record, its `neighborhood` and city name swapped (East Austin ↔ Logan Square): talking points identical
  except the city word in the rank line and sister rooms (no neighbourhood-based wording).
- L4: the agent (agent job's test, using our envelope): the Why drawer's age skew present ↔ absent → agent reply makes
  no statement about people's ages unless the rep asked about ages, and then cites `[qloo:age]`.

### 7.4 Empty slot
- E1: return visit, no note, no contact → "Following up from Tuesday." opener, role line, no quote, no name.
- E2: no crowd text (exists) → template opener. E3: unknown kind → neutral ask (exists).
- E4: an expired stated record (61 days) → first-visit lines plus "you last visited <date>".
- E5: an unmatched objection ("the owner hates cans") → quoted as the rep's words, no invented reply.
- E6: envelope for a door with no slots → `slots: []`, `contact: null`; `checkReply` drops any claim about the buyer.

### 7.5 Correction
- C1: edit the note → close → reopen → reload the store (JSON round-trip) → "Your version" shown; export CSV/notes use it.
- C2: `rule.avoid "price"` → no line with "price" on any door's talking points or notes; removing the rule restores them.
- C3: `rule.term NA → alcohol-free` → every output says "alcohol-free"; a model lead with "NA" is replaced too.
- C4: correction beats Qloo: rep marks the crowd opener "not true" → `rule.avoid` on that door's crowd phrase → template
  opener for that door only; other doors keep theirs.
- C5: correction beats stated: rep edits a logged objection (price → space) → pushback follows the edit.

### 7.6 Judging and claims
- Blind pairwise (slots on vs. off) on W1, W3, W4: 6 pairs, three levels (said / applied / done). **Judges: Jard
  (owner, n=1) unless he names a working rep or founder** (Q1). An automated screen may run with a model different
  from the generator (generator: `gemini-3.1-flash-lite` offline + templates; screen: Workers AI Llama), labelled a
  screen, never the result.
- Claim wording for SUBMISSION/README: "On N scenarios, the version that remembers the last visit was preferred by
  <k> of <n> judges (<who>)." Nothing broader. Untested = labelled untested.

## 8. Build plan (time-boxed to the freeze, Tue Oct 28 18:00 ET)

| # | When | Box | What | Done when |
|---|---|---|---|---|
| status | Oct 22 | | **B0–B6 built**: slots.js; return visit; SMS; edited note; Your rules (every city); timing by venue type; 19 slot tests; `scripts/slots-report.mjs` (on/off table). Open: Q1 judges; probe room tags (post-freeze unless time) | |
| B0 | Wed Oct 22 | 2 h | This file → the integrator merges early | on v2-tour |
| B1 | Wed–Thu | 3 h | `lib/slots.js`: record, `resolve`, expiry, `fromNote`, `memoryFor`, `applyRules`, `redact`, `envelope`, `checkReply`; `store.slots` + setters | unit tests |
| B2 | Thu Oct 23 | 5 h | S1+S4 return visit in `talk.js`, `note.js`, `stopModel` (+ trace `src`), outcome sheet writes records | W1, W2, E1, E4, E5, L1, L2, ablation |
| B3 | Fri Oct 24 | 2 h | S3 `noteFor(…, "sms")`, Text button uses it | W3 |
| B4 | Fri–Sat | 4 h | S6: note edits persist ("Your version"), "Don't say this", rules in Edit profile, `applyRules` last everywhere | C1–C5 |
| B5 | Sat Oct 25 | 2 h | S1 timing norms by venue type | W4 |
| B6 | Sun Oct 26 | 3 h | `test/slots-eval.test.mjs` scenario set + `scripts/slots-report.mjs` (swap/ablation table as markdown for SUBMISSION) + "What you logged" on the stop | all §7 automated rows green |
| — | Mon–Tue | buffer | merges, demo beat (Thursday Nomadic return shows "Hi Sam"), 390 px check | freeze |

Cut order if late: B5, then the "What you logged" editor (records still editable by re-saving the outcome), then C4.
The agent job consumes `envelope`/`checkReply`/`redact` from B1 (Thu); until then it can stub against §4.

## 9. Assumptions and open questions

Assumptions (flag if wrong): the audience is the one named at the top, English only; a return visit is the most visible
cultural failure (owner's own words: "that's not how people talk"); notes stay on the device (localStorage) as today.

Decided:
- **Q2 — Visit notes and a free LLM: yes, redact.** Code (`slots.redact`) strips contact names before **any** LLM call
  (tested), and the app says: "Your notes are sent to Google's Gemini to understand them; names are removed first."
- **Q3 — Expiry: yes.** Visit facts 60 days, contact names 180 days.
- **Q4 — Rule scope: every city.** Brand-wide rules (`rule.avoid`, `rule.term`) live in one shared per-brand key
  (`doors.v2.rules.<brand>`), read by every brand-city.
- **Q5 — Age skew: keep** in the Why drawer as Qloo's aggregate about the **room**, labelled with its source. The agent
  mentions it only when asked, never as a claim about a person.
- **Q6 — SMS cap: 320 characters.**

Open (for Jard):
- **Q1 — Judges.** Does he know one working drinks rep or founder who would blind-judge 6 pairs (~10 min)? Until he
  says so, every claim reads "owner-reviewed, n = 1".

## 10. R9 deep signals

Qloo's room tags (on every door, 0 calls; held routes backfilled from the cached raw responses by
`scripts/deep-tags.mjs`) enter as `qloo` facts with their field (`tag:time_of_day_fit`, `tag:beverage_offering`,
`tag:menu_highlight`, `tag:interests`), each wired into one decision and each switchable off (`deepOff` on
`buildPool` / `talkPoints` / `stopModel`; `?deepOff=tod,lead,hooks,heat` or `?deep=off` on the page):

| key | decision | authority |
|---|---|---|
| `tod` | which day a door goes on (planner: a window inside the room's crowd times costs up to 4 min, relative to the door's best day); the arrival line where Qloo's per-room crowd times and the S1 clock (global or by venue type) disagree | beats S1's default clocks; the room's own hours (opening, closing, wait) win |
| `lead` | the opener's question (a cocktail room, a dish the room is known for, a specialty-NA list), the ask (a cocktail on the menu), a gate question + sample ask when the room's drinks tags miss the product's category | the rep's ask (stated) and a return visit's memory win |

| `hooks` | small talk on the stop ("People who drink <brand> also like the podcast <title>. Bring it up if sports comes up."): only the brand's own items (dropped: any a same-category brand's fans share, or 3+ brands'), and only where the room's interests/ambience/genre meet the item's genre; else none (12–22 of 60 rooms) | private context for the rep, never said as a claim about the room |
| `heat` | which part of town the first day works: the planner's area with the most doors in the top 3 hoods of Qloo's heatmap for the brand × city takes the first day (same hours and start only), and such a door costs 3 min on a later day; the plan foot says "Work first: …", the stop "Part of town: X, #k of N on Qloo's map" | rank only, no strengths |

Data: `public/data/culture/hooks.json` (8 held brands + Truly; TV, podcasts, trips) and `heat.json` (8 held brands ×
4 cities), from `scripts/deep-hooks.mjs` / `scripts/deep-heat.mjs` (49 ledgered calls, sources `deep-hooks`,
`deep-heat`; raw in gitignored `data/culture-raw/`). A live brand run asks the same (TV, podcasts, heatmap: 3 calls,
`COST.route` 29) and carries them as `route.culture`. Prewarmed runs have neither room tags (978 of 9,421 venues) nor
culture: no deep signal there until re-run.

The envelope (§4) carries them as `qloo.tags` (sourced room-tag facts), `qloo.hook`, `qloo.hood` and `qloo.decided`
(what tod and lead changed on this stop): the agent cites `[qloo:tag:<field>]`, `[qloo:hook]`, `[qloo:heatmap]`.
`scripts/slots-report.mjs` rows D1–D6 show each on vs. off. Measured: time-of-day tags are broad (most bars are
tagged afternoon + evening + late night), so the day-choice effect is small (Austin, 3 days at 3 times: 13 of 16
in-crowd arrivals vs. 15 of 17 off). The guided demo's planner keeps `tod` and `heat` off (`culture.DEMO_DEEP_OFF`: the tour's steps
depend on the baked plan); its stops still show the tags, the lead and the hooks.
