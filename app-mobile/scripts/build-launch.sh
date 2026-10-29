#!/bin/zsh
# The launch build of the Doors iPhone app: Release, talking only to the published https Worker, no ATS exception.
#
#   app-mobile/scripts/build-launch.sh https://doors.example.workers.dev            # signed archive + .ipa (Mac Terminal)
#   app-mobile/scripts/build-launch.sh https://doors.example.workers.dev --check    # unsigned build, checks only (ssh ok)
#   app-mobile/scripts/build-launch.sh https://doors.example.workers.dev --sim      # the launch build on a simulator
#
# It builds from a separate worktree (<repo>-launch, beside this clone, at its's HEAD) so the dev build's native folder
# (ios/, made from app.json with the LAN exception) is never touched. Nothing is uploaded: the .ipa is left in
# <worktree>/app-mobile/build/ for Xcode's Organizer / Transporter (JARD-STEPS-TESTFLIGHT.md).
# Env: TEAM (default 292WF25JK4), DOORS_BUILD_NUMBER (default yymmddHHMM; must grow with every upload),
#      SIM (simulator name or udid for --sim, default "iPhone 17"), LAUNCH_DIR (worktree path).
set -euo pipefail
API=${1:-}
MODE=${2:---archive}
[[ $API =~ ^https://[^/]+$ ]] || { echo "usage: $0 https://<published worker, no trailing path> [--archive|--check|--sim]"; exit 2; }
[[ $MODE == --archive || $MODE == --check || $MODE == --sim ]] || { echo "unknown mode $MODE"; exit 2; }
[[ -z ${EXPO_PUBLIC_DOORS_NOW:-} ]] || { echo "EXPO_PUBLIC_DOORS_NOW pins the clock (dev only): unset it for a launch build"; exit 2; }
[[ -d /opt/homebrew/opt/node@22/bin ]] && export PATH=/opt/homebrew/opt/node@22/bin:$PATH
export LANG=en_US.UTF-8 CI=1

REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
DIR=${LAUNCH_DIR:-$REPO-launch}
TEAM=${TEAM:-292WF25JK4}
export DOORS_LAUNCH=1 EXPO_PUBLIC_DOORS_API=$API DOORS_BUILD_NUMBER=${DOORS_BUILD_NUMBER:-$(date +%y%m%d%H%M)}

# 0. the Worker must answer over https (a launch build pointed at nothing is a dead app)
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$API/data/index.json" || true)
if [[ $code != 200 ]]; then
  echo "!! $API/data/index.json answered '$code', not 200. Publish the Worker first."
  [[ $MODE == --check ]] || exit 1
fi

# 1. a clean worktree at this checkout's HEAD
HEAD=$(git -C "$REPO" rev-parse HEAD)
if [[ -d $DIR ]]; then git -C "$DIR" checkout -q --detach "$HEAD"; else git -C "$REPO" worktree add -q --detach "$DIR" "$HEAD"; fi
echo "== launch build $(git -C "$DIR" log --oneline -1 | cut -c1-70) · API $API · build $DOORS_BUILD_NUMBER · $MODE"
cd "$DIR/app-mobile"
npm ci --silent --no-audit --no-fund

# 2. the native project from app.config.js in launch mode (no ATS exception), then the build
npx expo prebuild --platform ios --clean --no-install >/dev/null
(cd ios && pod install --silent)
OUT=$DIR/app-mobile/build
mkdir -p "$OUT"
case $MODE in
  --archive)
    xcodebuild -workspace ios/Doors.xcworkspace -scheme Doors -configuration Release -destination generic/platform=iOS \
      -archivePath "$OUT/Doors.xcarchive" DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates archive \
      | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)"
    APP="$OUT/Doors.xcarchive/Products/Applications/Doors.app"
    cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
    xcodebuild -exportArchive -archivePath "$OUT/Doors.xcarchive" -exportPath "$OUT" -exportOptionsPlist "$OUT/ExportOptions.plist" \
      -allowProvisioningUpdates | grep -E "error:|EXPORT (SUCCEEDED|FAILED)"
    ;;
  --check)
    xcodebuild -workspace ios/Doors.xcworkspace -scheme Doors -configuration Release -sdk iphoneos -destination generic/platform=iOS \
      -derivedDataPath "$OUT/dd" CODE_SIGNING_ALLOWED=NO build | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
    APP="$OUT/dd/Build/Products/Release-iphoneos/Doors.app"
    ;;
  --sim)
    SIM=${SIM:-iPhone 17}
    xcodebuild -workspace ios/Doors.xcworkspace -scheme Doors -configuration Release -sdk iphonesimulator \
      -destination "platform=iOS Simulator,name=$SIM" -derivedDataPath "$OUT/dd-sim" CODE_SIGNING_ALLOWED=NO build \
      | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
    APP="$OUT/dd-sim/Build/Products/Release-iphonesimulator/Doors.app"
    ;;
esac

# 3. checks on the built app: no ATS exception, no local-network prompt, the bundle talks to $API and to no http host
P="$APP/Info.plist"
fail=0
/usr/libexec/PlistBuddy -c "Print :NSAppTransportSecurity" "$P" >/dev/null 2>&1 && { echo "!! Info.plist still has NSAppTransportSecurity"; fail=1; }
/usr/libexec/PlistBuddy -c "Print :NSLocalNetworkUsageDescription" "$P" >/dev/null 2>&1 && { echo "!! Info.plist still asks for the local network"; fail=1; }
echo "   version $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$P") ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$P")) · $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$P")"
B="$APP/main.jsbundle"
grep -aq "$API" "$B" || { echo "!! the JS bundle doesn't carry $API"; fail=1; }
grep -aqE "http://(127\.0\.0\.1:8850|192\.168\.)" "$B" && { echo "!! the JS bundle still names a LAN dev server"; fail=1; }
# a pinned dev clock (src/devclock.ts): its marker string is compiled in only when EXPO_PUBLIC_DOORS_NOW is set
# (unset, the whole block is dead code); Hermes keeps the date as a separate string, so the marker is the signal
grep -aq "DOORS_PINNED_CLOCK=" "$B" && { echo "!! the JS bundle carries a pinned clock (EXPO_PUBLIC_DOORS_NOW)"; fail=1; }
[[ $fail == 0 ]] || { echo "LAUNCH CHECKS FAILED"; exit 1; }
echo "   checks ok: no ATS exception, no local-network prompt, no pinned clock, API $API"
case $MODE in
  --archive) echo "DONE. Upload $OUT/Doors.ipa with Transporter (or Xcode Organizer: $OUT/Doors.xcarchive)." ;;
  --sim) xcrun simctl boot "$SIM" 2>/dev/null || true; xcrun simctl install "$SIM" "$APP" && xcrun simctl launch --terminate-running-process "$SIM" com.joshuawhite.doors; echo "DONE (simulator)." ;;
  --check) echo "DONE (check build, unsigned)." ;;
esac
