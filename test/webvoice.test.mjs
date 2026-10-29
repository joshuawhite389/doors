// Doors web voice parity: the navigation app the rep chose drives
// Navigate (drive mode) and Directions (the stop); none chosen → by the browser, as before. The mic's words match the
// phone's MicButton.
import test from "node:test";
import assert from "node:assert/strict";
import { navigateUrl } from "../public/lib/drive-day.js";
import { directionsUrl, navAppOf, navAppName, NAV_APPS } from "../public/lib/note.js";
import { micLabel } from "../public/ui/voice.js";

const v = { name: "Room A", address: "1 Main St", lat: 30.26, lon: -97.74 };
const linux = "Mozilla/5.0 (X11; Linux x86_64)";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

test("nav app: the phone's three, by name; nothing chosen → by the browser", () => {
  assert.deepEqual(NAV_APPS.map((a) => a.name), ["Apple Maps", "Google Maps", "Waze"]);
  assert.equal(navAppOf(null, iphone), "apple");
  assert.equal(navAppOf(null, linux), "google");
  assert.equal(navAppOf("bogus", linux), "google");
  assert.equal(navAppName("waze", iphone), "Waze");
  assert.equal(navAppName(null, linux), "Google Maps");
});

test("Navigate opens the chosen app, whatever the browser", () => {
  assert.match(navigateUrl(v, linux, "apple"), /^https:\/\/maps\.apple\.com\/\?daddr=30\.260000%2C-97\.740000&q=Room%20A&dirflg=d$/);
  assert.match(navigateUrl(v, iphone, "google"), /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=30\.260000%2C-97\.740000&travelmode=driving$/);
  assert.equal(navigateUrl(v, iphone, "waze"), "https://waze.com/ul?ll=30.260000%2C-97.740000&navigate=yes");
  assert.equal(navigateUrl({ name: "X", address: "1 Main St" }, "", "waze"), "https://waze.com/ul?q=X%2C%201%20Main%20St&navigate=yes");
  assert.equal(navigateUrl(v, linux), navigateUrl(v, linux, null)); // unchanged without a choice
});

test("the stop's Directions follow the same choice (Waze starts from where the phone is)", () => {
  const a = { lat: 30.25, lon: -97.72 };
  assert.match(directionsUrl(a, v, linux, "apple"), /^https:\/\/maps\.apple\.com\/\?saddr=30\.250000,-97\.720000&daddr=30\.260000,-97\.740000&dirflg=d$/);
  assert.equal(directionsUrl(a, v, iphone, "waze"), "https://waze.com/ul?ll=30.260000,-97.740000&navigate=yes");
  assert.match(directionsUrl(a, v, iphone, "google"), /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/);
});

test("mic words = the phone's MicButton", () => {
  assert.equal(micLabel("idle", 0, "Tap and say a note"), "Tap and say a note");
  assert.equal(micLabel("listen", 0, "x"), "Listening… tap when done");
  assert.equal(micLabel("listen", 4, "x"), "Listening… tap when done (4 s)");
  assert.equal(micLabel("reading", 4, "x"), "Getting your words…");
});

test("the door card's safety line names Log visit (web and phone share it)", async () => {
  const { DRIVE_WORDS } = await import("../public/lib/drive-day.js");
  assert.equal(DRIVE_WORDS.safe(true), "For between stops: park before you read or type. Log visit listens: tap the mic and say how it went.");
  assert.equal(DRIVE_WORDS.safe(false), "For between stops: park before you read or type. Log visit takes a quick tap or a few typed words.");
});
