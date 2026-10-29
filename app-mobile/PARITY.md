# Doors phone app: parity with the web app

Jard, 2026-10-22: "the mobile app is the entire app." Every web screen, state and action, natively in `app-mobile/`.
Logic stays the web's own (`../public/lib`, shared through Metro); only the view layer is ported. The plan view's
controller (`public/ui/plan.js` compute/replan/actions) is ported DOM-free to `src/engine.ts` over the same lib calls.
Saved state uses the web's store (`public/lib/store.js`, same keys) on AsyncStorage. Same Worker API.

Legend: **S1–S4** = the slice that ships it. "≈" = same function, phone-native form (named below).

## Navigation (phone)

Stack navigator with a header Back on every screen (no new native deps).
`Home → Brand form → Building → Plan → {Stop → Room · Outcome sheet} · Add a door · Why these rooms · Settings → {Edit profile · Export} · Ask · Drive`.
`Home → Guided demo` (scripted, over the same screens). Drive mode keeps Door / Day / Ask and gains **Back to plan**.

| Web | Phone screen | Slice |
|---|---|---|
| `/` landing (index.html + ui/landing.js) | **Home** | S1 |
| `/app` bare → newest saved plan | app opens the newest saved plan, else Home | S1 |
| `#/new`, `#/edit`, `#/edit?copy=1`, `#/new?blank=1` (ui/profile.js) | **Brand form** (new / edit / duplicate / blank) | S1 |
| live run "Doors is asking Qloo…", resting, errors (plan.js runLiveView) | **Building** | S3 |
| building phase (animate.js runBuilding, buildSteps) | **Building** (steps + map reveal ≈) | S1 (steps) / S3 (map) |
| `#/plan` (ui/plan.js) | **Plan** | S1 |
| stop panel (ui/stop.js) + outcome sheet (ui/outcome.js) | **Stop** + **Outcome sheet** | S1 (core) / S2 (all) |
| room deep-dive (ui/room.js) | **Room** | S3 |
| Add a door (plan.js drawAdd) | **Add a door** | S2 |
| What your plan is based on (ui/why.js + lib/basis.js) | **What your plan is based on** (screens/Why.tsx) | S3 |
| Export drawer (ui/export.js) | **Export** | S3 |
| Ask Doors (ui/agent.js) | **Ask** (plan-wide) | S2 |
| Drive mode (ui/drive.js) | **Drive** (exists; now on any saved plan) | S1 |
| `#/demo` guided demo (ui/demo.js, coach.js) | **Guided demo** | S4 |
| PWA carry (ui/carry.js) | n/a: the app is installed; nothing to carry | — |

## Home (landing)
- Hero: "Plan your sales days in a new city.", lede, who line, 4 steps, For brands / For reps cards, tagline, Qloo/OSRM credits. **S1**
- Hero map: the baked Austin demo day on a native map with numbered pins, caption "{drinker} · Austin · Tue 1–6 pm · N doors" and OSRM credit; still (no loop animation) ≈. **S1**
- Watch the tour → Guided demo (**S4**; until then the demo plan opens directly). Start with my brand → Brand form. **S1**
- Saved plans: "Open your plan: {brand} · {city}", "Your plans" list (rows from `planRow`: name in city, N days · dates · Opened X), Duplicate, Delete with inline confirm ("Delete X in Y? Its statuses, outcomes and contacts go too." Delete / Keep), empty text. **S1**
- Footer: "Saved on this device only." **S1**

## Brand form (`#/new`)
- Heading "Your brand" / "Edit your brand", sub-line, edit note ("Editing X in Y…" / "Copy of X in Y…") + New profile. **S1**
- Examples row: 9 example chips (lib/examples.js), fiction line, Clear the form. **S1**
- Fields, all with the web's validation (`validateProfile`, touched-only errors, "Still needed: …", Build disabled until ok): **S1**
  1. Brand name · 2. What you make (re-derives Rooms + ask placeholder) · 3. Sign your notes as
  4. Your drinker also drinks… (≤3): held brands + drinks.json as you type, "Search Qloo for “x”" (`/api/search?type=brand`), all its notes/errors
  5. Rooms that already pour you (≤3): index rooms + "Search Qloo" (`/api/search?type=room`)
  6. Opening city: city list (lib/citylist.js) incl. "X?" nearest, "Use “X” (not on Doors' city list)" live city + `/api/geocode?kind=city`; `setCity` resets far starts
  7. Rooms to pitch chips · 8. Where your day starts: address autocomplete (`/api/geocode?kind=auto` / plain), start chips, **Drop a pin** (native map, tap to set, draggable) and its label
  9. When you're free: next-7-day chips, Another day (date) + Add, per-day from/to (15-min steps), per-day Start elsewhere (address / pin / chips / Cancel / use my usual start), ×
  10. Time at each door · 11. Your pitch (price, ask + hint, support chips) · 12. Doors you already know (search ranked rooms, "#i · Already talked to", hints)
- Build my plan → saves like the web (`store.update(…, {profile, current:null})`) → Plan. Draft kept on every edit. **S1**
- Native pickers ≈: date/time fields use RN steppers/chip lists (no native date-picker dep).

## Plan (`#/plan`)
- Header: brand · city, drinker line; Your plans menu (→ Home list). **S1**
- Tabs: each day "Tue · N doors" (colour), "Your list · N", "Week". The other days always show faint on the map; one toggle "Show N more ranked doors" (web: per-day layer chips + the same toggle). **S1** (tabs) / **S2** (layer toggle)
- Day view: "{Day} in {City}", meta (doors · mi · times · visited · leave), **Up to [Any…12] doors a day**, progress bar + text, planner notes (folded when ≥2), stops with legs, pins (✓ when visited), name, genre · rank line · Website, tags (My contact / Added by you / carried over / status / outcome / 🔒 / re-routed), ETA + open-till / order reason, empty and ended states. **S1**
- Row ⋯ menu: Visited / Already talked to / Not a fit / Undo / Remove my contact / Remove from my plan / Move up / Move down / Move to {day} / Lock it here / Unlock. (Web drag-and-drop ≈ these menu moves, which the web also has.) **S1** (status) / **S2** (moves, locks, removes)
- Week view: day heads (tap → day) + compact stops. **S1**
- Your list: every ranked room best first, on-day button (opens the stop), reason when not on a day, "+ Add" → Add to {days} / Let Doors choose, marked rows with Undo, Your own doors, Marked sections. **S1** (rows) / **S2** (Add to)
- Carried-over notices with dismiss ×. **S1**
- Footer: leave · min a stop · travel label (road/estimate/demo note), heat line "Work first: …", hours captured. **S1**
- Toast with Undo for every re-plan (replanSummary). **S1**
- Map: day routes (road when known, dashed estimate), starts, numbered pins in day colours, overlapping pins as a "13 doors" pill (tap to zoom; every pin and pill has a VoiceOver label), ranked-door tiles "#14" (a tile or pill that would touch a stop's pin or pill steps clear of it, phone) + card (rank line, type, crowd, why not on a day, Website, Open the room, Add to …). **S1** (routes/pins) / **S2** (rank pins + card)
- Top of the plan (Jard 10-23 19:00 #5–#8): **Start my day** (Drive, S1) and the Why button (**Why these doors**, S3). **Doors Agent** (S2): phone, one round button bottom-right on every app screen (lifted above a footer, hidden under a sheet); web, the header's Agent (a narrow web page: the same round button). **Menu**: phone, ☰ top-left of the plan (the app's root, no Back); web, the header's Menu: **Home** (the landing, outside the app), **Export** (S3), **Settings** (Edit profile S1, the navigation app; phone also read-aloud and placeholder rows), **Privacy** (phone: an in-app Safari sheet). **▶ Watch the route** is web-only, on the map's run bar (■ Stop · speed slider). Phone: an edge swipe goes Back (and forward after a Back).

## Stop
- Header "← All stops", ‹ Stop N of M ›; kicker (arrive · day · stop · follow-up visit), name, meta, Website. **S1**
- Outcome tags + note quote. **S1**
- Facts: Arrive (+ wait), Open today (warn), Phone (Call), Directions (Apple Maps, leg label). **S1**
- Why this room: affinity line, why lines + caption, heat chip, Qloo tags, "See everything Qloo knows" → Room. **S1** (lines) / **S3** (Room)
- Talking points: source legend + counts, return-visit caption, Before you walk in / Opener / Small talk / Questions to ask (ticks) / Points to make (ticks, footnotes) / Likely pushback / The ask, per-line source chips, talkLabel + hidden-by-rules count. **S1**
- Drafted note: subject + body editable (saved as a `note.email` correction slot), Reset to draft, **Share** (≈ Copy: the iOS share sheet has Copy), Email (mailto), Text (sms). **S2**
- Your rules: list + Remove, "Never say …", "Say … instead of …". **S2**
- Sister doors: one row on the card ("3 on your route · All 18", intuitiveness audit #3) → its page (DoorPage `sisters`; web stop.js page `sisters`): on your route first, each with its plain reason, Open / + Add, "Qloo's match scores for these doors ›" (Room). **S2**
- The Qloo record fold. **S2**
- Footer: Not a fit / Already talked to / Call / ✓ Mark visited; visited: Undo / Change outcome; talked/notfit: Undo. Mark → opens next stop + toast with Undo. **S1**
- Outcome sheet: quick choices (✓ Interested, Interested · back {date}, ↻ Follow up {date}, Talked to someone else, No), Add details (result, who, come back + date, note), errors, Save outcome, Cancel; follow-up → Week + followUpToast. **S1**

## Room (deep-dive)
How chosen · taste match per drinker (affinity, rank bar, famous row) · age bands · other brands' ranks (loads others' lists) · popularity & rating · crowd and room (quotes, chips, Website/Menu) · the crowd's music (none / held / genres+artists) · sister rooms (tally, open sister, Open stop, + Add) · footer. **S3**

## Add a door
Find it on Qloo (search, results with "already ranked #k of N", Add / Added, errors, no-match) · Enter it myself (name, address autocomplete, Drop a pin on a map, Add as my contact) · Back to the plan. **S2**

## Why these rooms
Header + subtitle · drinker tabs · the sieve (≈ native rows: 6 gates + Your plan + Look-alikes with counts, ‹ Play/Pause/Replay ›, captions, row info: reason chips + place list, "Why isn't … on my plan?" search) · 4 tiles · tray (picked rooms, Show on map, Clear) · findings · match curve · popularity vs match (rho) · who skews where · shared crowds · crowd in Qloo's words · what the crowds listen to · what Doors left out + **Include the famous rooms** toggle (re-plans) · picks light rooms on a map; room cards with Add to my plan and ‹ › stepping. Charts drawn natively (Views, no SVG dep). **S3**

## Export
Plan as CSV, Drafted notes, Call sheet (as text) — each through the iOS share sheet (Save to Files, Mail, Copy, Print from the sheet). **S3**

## Ask Doors (plan-wide)
Header + model badge, empty text, 4 suggestion chips, user/agent bubbles, Sources (n) fold, did-line + Undo on the last message, resting note, "…" + "Still working" after 10 s, 25 s timeout → rules on the phone; context = agentContext of the open plan + current stop; "why isn't X first" → whatIfFirst trade; applies status / outcome / slot / talk / replan / open (all, not just status+outcome as today). Chat kept per plan. **S2**

## Drive
As now (Door / Day / Ask, Done → log-visit → Save → next, Navigate, Undo, voice, caret follow), but on the open plan through the engine (same saves as the web's drive), plus the web's: late banner "Move those n to {day}", Skip for now (moves to the day's end), Read it to me, Day done / Last door states, and **Back to plan**. **S1** (on any plan + back) / **S2** (late, skip)

## Guided demo
Sandbox (demo store prefix, `/api/*` refused, rules-only Ask, baked roads), banner (Maya Ortiz · Tidewell · Austin, Step i of N, Restart, Skip to the finished plan, Close tour), the 23 steps of lib/demo-script.js as coach cards over the real phone screens (Continue / Do it for me / wait), off-script and resumed states, hand-off "Start with my brand". **S4**

## Not ported (web-only, by design)
PWA carry / Add to Home Screen (the app is installed) · desktop-only layout (drawers beside the map, keyboard drag) · `?routing=v4`, `?rankv`, `?deep=off`, `?ors=off`, `?instant=1` debug flags · print dialog (the share sheet's Print).

## Validation per slice
tsc + `expo export --platform ios`; repo `npm test` + `scripts/export-public.sh` on the committed HEAD; iPhone 17 simulator shots while building; then a signed install on Jard's iPhone 17 and real-device screenshots of every screen × state above for that slice before it is called done.
