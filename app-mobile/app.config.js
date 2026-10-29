// app.json is the dev build (talks to a LAN dev Worker over http, so ATS allows arbitrary and local loads).
// DOORS_LAUNCH=1 is the launch build (scripts/build-launch.sh): it talks only to the published https Worker, so it
// carries no ATS exception and no local-network prompt, and it refuses to build without an https EXPO_PUBLIC_DOORS_API.
const { withInfoPlist, withDangerousMod, withAppDelegate } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// prebuild's template adds its own ATS block (arbitrary loads off, local networking on): the launch build has none
const noAts = (config) => withInfoPlist(config, (c) => {
  delete c.modResults.NSAppTransportSecurity;
  delete c.modResults.NSLocalNetworkUsageDescription;
  return c;
});

// The launch screen (every build): prebuild's storyboard shows an image named "SplashScreen" on the system's white,
// and SDK 58 only fills it through expo-splash-screen (a native module we don't add). So: the door (assets/splash,
// 120 pt) as that image set, on the app's own cream (#F7F6F2), so opening Doors doesn't flash white.
const CREAM = { red: 247 / 255, green: 246 / 255, blue: 242 / 255 };
const withDoorsSplash = (config) => withDangerousMod(config, ["ios", async (c) => {
  const app = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
  const set = path.join(app, "Images.xcassets", "SplashScreen.imageset");
  fs.mkdirSync(set, { recursive: true });
  const images = [1, 2, 3].map((n) => {
    fs.copyFileSync(path.join(c.modRequest.projectRoot, "assets", "splash", `door@${n}x.png`), path.join(set, `door@${n}x.png`));
    return { idiom: "universal", filename: `door@${n}x.png`, scale: `${n}x` };
  });
  fs.writeFileSync(path.join(set, "Contents.json"), JSON.stringify({ images, info: { version: 1, author: "expo" } }, null, 2));
  const sb = path.join(app, "SplashScreen.storyboard");
  if (fs.existsSync(sb)) {
    const bg = `<color key="backgroundColor" red="${CREAM.red.toFixed(4)}" green="${CREAM.green.toFixed(4)}" blue="${CREAM.blue.toFixed(4)}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>`;
    fs.writeFileSync(sb, fs.readFileSync(sb, "utf8").replace(/<color key="backgroundColor"[^>]*\/>/, bg));
  }
  return c;
}]);

// Owner 10-23 (his iPhone 17): voice and Read it to me were silent with the ring/silent switch on. iOS starts an app in
// the "solo ambient" audio session, which the switch mutes. Doors speaks on purpose (drive mode, a read-out a rep asked
// for), so the session is "playback" in the spoken-audio mode, as a podcast or navigation app is: the switch no longer
// mutes it. It mixes with other audio (and pauses a podcast while it talks), so music keeps playing under it.
// Every build: expo-speech's AVSpeechSynthesizer uses the app's session.
const withSpokenAudio = (config) => withAppDelegate(config, (c) => {
  let src = c.modResults.contents;
  if (c.modResults.language !== "swift") throw new Error(`withSpokenAudio expects a Swift AppDelegate (got ${c.modResults.language})`);
  if (!src.includes("import AVFoundation")) src = src.replace(/^(internal import Expo\n)/m, "$1import AVFoundation\n");
  const call = "return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
  if (!src.includes("AVAudioSession")) {
    if (!src.includes(call)) throw new Error("withSpokenAudio: AppDelegate has no didFinishLaunching return to hook");
    src = src.replace(call, `// Doors: speech plays with the silent switch on (app.config.js withSpokenAudio)
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers, .interruptSpokenAudioAndMixWithOthers])
    ${call}`);
  }
  c.modResults.contents = src;
  return c;
});

module.exports = ({ config }) => {
  config = withSpokenAudio(withDoorsSplash(config));
  if (process.env.DOORS_LAUNCH !== "1") return config;
  const api = process.env.EXPO_PUBLIC_DOORS_API ?? "";
  if (!/^https:\/\/[^/]+/.test(api)) throw new Error(`DOORS_LAUNCH=1 needs EXPO_PUBLIC_DOORS_API=https://… (got "${api}")`);
  const { NSAppTransportSecurity, NSLocalNetworkUsageDescription, ...infoPlist } = config.ios.infoPlist;
  return noAts({
    ...config,
    ios: { ...config.ios, infoPlist, ...(process.env.DOORS_BUILD_NUMBER ? { buildNumber: process.env.DOORS_BUILD_NUMBER } : {}) },
  });
};
