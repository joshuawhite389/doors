This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Doors: on-screen UI validation (Jard's standard, 2026-10-22) — required before anything is "done"

A change isn't done until real screenshots of **every screen × state** are clean: no clipped or truncated text, no
overlap, nothing off-screen, nothing a user can't scroll to, nothing under the notch / Dynamic Island / home bar, text
wraps. Method (the cofounder's size matrix, adopted; runs on the Mac, never on jard-ser):

1. **Simulators first** (iOS 26.5 runtime): iPhone SE 3rd gen (4.7"), 13 mini (5.4"), 17 (6.3"), 17 Pro Max (6.9").
   Create missing ones with `xcrun simctl create`. Open the app: `xcrun simctl openurl <udid> exp://<mac-lan-ip>:8081`
   (Expo Go; if it insists on a sign-in, build a simulator dev client instead: `npx expo run:ios`, no signing for sims).
2. **Text size**: `xcrun simctl ui <udid> content_size extra-small | large | accessibility-extra-extra-extra-large`
   (booted sim), then relaunch the app (RN reads it at start).
3. **Keyboard**: `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false`, restart Simulator, tap the
   field (Appium/WDA or idb) → shots with the software keyboard UP and DOWN.
4. **States to shoot** (name `device_textsize_screen_state.png`, `xcrun simctl io <udid> screenshot`): Door (current; a
   viewed non-current stop; day done), Done sheet (empty; 2+ lines of text; keyboard up; read-back; an `ask`), Day (map +
   list; a pin callout), Ask (empty with chips; a long reply with facts; keyboard up with 3+ lines typed), the Undo toast
   with the longest text, the error screen. Seed the longest real strings.
5. **Check**: read every PNG; also dump the accessibility tree (WDA `GET /source`) and flag any element whose frame is
   outside the window or intersects a sibling, and anything VoiceOver can't reach. Table: device | text size | screen |
   state | problem | severity | shot.
6. **The real iPhone XS last**, as the confirming pass: WDA `GET /screenshot`. Dynamic Type on a device only via
   Settings > Accessibility > Display & Text Size > Larger Text (WDA taps; set it back after). Never lock the phone.
   Lessons: the SE at XXXL breaks first; every sheet/modal must scroll at XXXL.

Voice: dictation goes through the iOS keyboard mic into **uncontrolled** TextInputs (defaultValue + ref). Never feed
`value` back into a field the rep dictates into: iOS drops words when the value is re-set mid-dictation.
