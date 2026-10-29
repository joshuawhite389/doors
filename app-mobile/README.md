# Doors on the iPhone (React Native, Expo)

The whole Doors app, native, on the same Worker API (`docs/CONTRACTS-R9.md`) and the web page's own plain-JS code
(`../public/lib`, shared through `metro.config.js`): only the view layer is ported. Its own package: the repo's
`npm test` and its no-deps rule don't see it. Screen by screen against the web app: `PARITY.md`.

**What's in it:** Home (Watch the tour, Start with my brand, your saved plans: open, duplicate, delete) → the brand form
(Examples, Qloo brand and venue search, start address or a pin) → Building (a live run's steps, resting and error
states, the "Qloo didn't answer for" gaps line) → the plan (map, day tabs, Your list, Week, Up to N doors a day, the
row menu's statuses and moves, toast + Undo; ☰ menu: Home, Export, Settings, Privacy; the round Agent button on every screen; edge swipe Back) → a stop (why this door with its sources, the drafted message to share,
email or text, talking points, Your rules, sister doors with + Add, the visit sheet with the closed-day check) · Door ·
Add a door · Why these doors · Export (through the share sheet) · Settings (Edit profile, the navigation app, drive read-aloud) · Ask (Doors Agent, plan-wide, every action) · Drive (the
current door with **Navigate** (Apple Maps) and a big **Done**: tap the mic and say it (the app's own mic, `src/mic.ts`: a WAV to the Worker's Whisper, `/api/voice/listen`; also beside Send in Ask) or type it → read back
(the Worker's Aura-2 voice, `src/voice.ts`; the device voice when it can't) → **Save** → next door, with Undo) · the guided demo. The controller of the web's plan view is ported
DOM-free to `src/engine.ts`; plans are saved with the web's own store (`public/lib/store.js`) on AsyncStorage. Offline,
or when the agent is resting, a visit and Ask go to Doors' rules on the phone (`visit-parse.js`, `agent-rules.js`).
Agent calls send `Origin: <the Worker's origin>` (CONTRACTS-R9 §0).

**Tested:** every `PARITY.md` row tapped on iOS simulators (iPhone 17 and 13 mini, Release builds), including a live
run for a new brand and city against a dev Worker with real Qloo calls; `npm run typecheck` and the iOS export. The same
Release build, signed, runs on two real iPhones: every `PARITY.md` screen tapped on an iPhone XS (iOS 18), and the owner's
own use on an iPhone 17 (iOS 27). Not in the App Store or TestFlight yet.

## Run it (Mac + Expo Go on the phone, same Wi-Fi)

On the **Mac only**: never bind `HOST=0.0.0.0` on jard-ser (production box; REVIEW9 rule). Expo Go 58 must be signed in
to the same Expo account as the Mac's Expo CLI (`npx expo whoami`), or it won't open the project.

```sh
# 1. a dev Worker the phone can reach, offline (SAMPLE=1: no keys, no Qloo), from the repo root
SAMPLE=1 HOST=0.0.0.0 node scripts/dev.mjs 8850
# 2. the app, pointed at it (the Mac's LAN IP), from app-mobile/
npm install
EXPO_PUBLIC_DOORS_API=http://<mac-lan-ip>:8850 npx expo start --lan
# 3. scan the QR code with the iPhone camera → opens in Expo Go
```

Checks: `npm run typecheck`; `npx expo export --platform ios` (the Hermes bundle builds, shared code included).

## The launch build (published Worker, no ATS exception)

`app.json` is the dev build: it talks to a LAN dev Worker over http, so its Info.plist allows arbitrary and local
loads. `app.config.js` drops all of that when `DOORS_LAUNCH=1`, and refuses to build without an https
`EXPO_PUBLIC_DOORS_API`. One command on the Mac makes the launch build from a separate worktree beside the clone (`<clone>-launch`), so
the dev `ios/` folder is left alone, then checks the built app (no ATS exception, no local-network prompt, the bundle
carries the URL):

```sh
app-mobile/scripts/build-launch.sh https://<published worker>            # signed archive + .ipa (Mac Terminal: keychain)
app-mobile/scripts/build-launch.sh https://<published worker> --check    # unsigned, checks only
app-mobile/scripts/build-launch.sh https://<published worker> --sim      # on a simulator
```

Nothing is uploaded. TestFlight steps: `../../JARD-STEPS-TESTFLIGHT.md` (outside the repo).
