// Judge pass 4, UI + story lane: the landing never redirects (N17), sister rooms are the rep's
// context, not a point to make (N24), the Ask footer says one thing in rules mode (N25), the form's date chips share
// one format, drive mode's address reads as an address, the demo's contact chip shows the tidy name (N22), the day
// tabs tell "on the map" from "shown in the list" (N15) and stay on screen in a short window (13), and a new service
// worker cache name ships with the self-hosted fonts (19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { talkPoints } from "../public/lib/talk.js";
import { lineSources } from "../public/lib/provenance.js";
import { dayChip } from "../public/lib/profile.js";
import { addressLine } from "../public/lib/stopmodel.js";
import { footFor, restNote } from "../public/ui/agent.js";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("N17: the landing never sends a returning visitor away; their newest plan is a button on it", () => {
  const s = src("public/ui/landing.js");
  assert.doesNotMatch(s, /location\.(replace|assign)\(|location\.href\s*=/);
  assert.match(s, /Open your plan: /);
});

test("N24: sister rooms are said to the rep (Before you walk in, Qloo's chip), never to the bar manager", () => {
  const venue = { id: "x", name: "Nomadic Beerworks", genre: "brewery", hours: null };
  const t = talkPoints({ venue, rank: 1, N: 55, drinkerName: "Athletic Brewing", city: "Austin", profile: { brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinksLike: ["Athletic Brewing"] }, eta: 14 * 60, isNA: true, sisters: ["Austin Beerworks", "Growler Express"], deepOff: true }, []);
  assert.ok(!t.points.some((p) => /Austin Beerworks|regulars Qloo matches/.test(p.text)), JSON.stringify(t.points));
  const i = t.before.findIndex((x) => /Austin Beerworks and Growler Express/.test(x));
  assert.ok(i >= 0, JSON.stringify(t.before));
  assert.match(t.before[i], /^Sister doors: /);
  const src2 = lineSources({ talk: t, profile: {} });
  assert.match(src2.before[i]?.label ?? "", /sister doors/);
});

test("N25: in rules mode the Ask footer is one line, and the resting note shows once, not under every answer", () => {
  const rules = { role: "agent", resting: true, message: "No model is connected here, so Doors' own rules answered." };
  assert.deepEqual(footFor(rules), { who: "This answer is from Doors' own rules: no model was used.", notice: false });
  assert.equal(footFor({ role: "agent", model: "Workers AI llama" }).notice, true);
  assert.equal(footFor(null).notice, true);
  assert.equal(restNote(rules, null), rules.message);
  assert.equal(restNote(rules, rules), "");
  assert.equal(restNote({ ...rules, message: "The free models are busy right now." }, rules), "The free models are busy right now.");
  assert.equal(restNote({ role: "agent", resting: false }, null), "");
});

test("18: the form's date chips share one format: 'Thu 29' this month or next, the month only when it's far", () => {
  const today = new Date("2026-10-22T12:00");
  assert.equal(dayChip("2026-10-29", today), "Thu 29");
  assert.equal(dayChip("2026-11-12", today), "Thu 12");
  assert.equal(dayChip("2026-12-03", today), "Thu Dec 3");
});

test("18: an address reads as one, with a comma before its city", () => {
  assert.equal(addressLine("3664 N Clark St Chicago, IL", "Chicago"), "3664 N Clark St, Chicago, IL");
  assert.equal(addressLine("1412 E 6th St Austin, TX 78702", "Austin"), "1412 E 6th St, Austin, TX 78702");
  assert.equal(addressLine("1412 E 6th St, Austin, TX 78702", "Austin"), "1412 E 6th St, Austin, TX 78702");
  assert.equal(addressLine("5170 S 72nd St Ste 106 Ralston, NE 68127", "Omaha"), "5170 S 72nd St Ste 106 Ralston, NE 68127");
  assert.equal(addressLine("", "Austin"), "");
  assert.match(src("public/ui/drive.js"), /addressLine\(v\.address/);
});

test("judge pass 8 #4: the tour's form shows no contacts block (the real form has none); BBG's is added on the plan", async () => {
  assert.doesNotMatch(src("public/ui/demo.js"), /My contacts|dcontact/);
  const { STEPS } = await import("../public/lib/demo-script.js");
  assert.match(STEPS.find((x) => x.key === "pitch").body.join(" "), /Doors to skip.*\+ Add a door/);
});

test("N15 + daytabs: the list's tab is the only filled one; tabs are real tabs, one click shows a day", () => {
  const css = src("public/css/doors.css");
  const rule = (sel) => css.match(new RegExp(`${sel.replace(/[[\]=.]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? "";
  const base = rule(".daytabs button");
  const current = rule(".daytabs button[aria-selected=true]");
  assert.ok(base && current);
  assert.notEqual(base.match(/background:[^;]+/)?.[0], current.match(/background:[^;]+/)?.[0]);
  assert.doesNotMatch(css, /\.daytabs button\[aria-pressed/); // no on/off states on the tabs: the map chips own that
  const plan = src("public/ui/plan.js");
  assert.match(plan, /class="daytabs" role="tablist"/);
  assert.match(plan, /role="tab" aria-selected=/);
  assert.doesNotMatch(plan, /toggleTab|layers\.days\.delete\(t\)/); // a tab never turns a day off (Jard 10-23: two clicks to see a day)
});

test("13: in a short desktop window the day tabs stick to the top of the scrolling column", () => {
  const css = src("public/css/doors.css");
  const block = css.slice(css.lastIndexOf("@media (min-width:901px) and (max-height:960px)"));
  assert.match(block, /\.daytabs\{[^}]*position:sticky[^}]*top:(0|var\(--sat\))/); // round 8: top is the status bar inset (0 on a desktop)
});

test("19: the service worker's cache name moved on with the self-hosted fonts", () => {
  assert.doesNotMatch(src("public/sw.js"), /const CACHE = "doors-shell-v1"/);
});

test("a step's own reveal reaches the coach (the answer card scrolls the reply into view, not the default)", () => {
  const s = src("public/ui/demo.js");
  const show = s.slice(s.indexOf("coach.show({"), s.indexOf("});", s.indexOf("coach.show({")));
  assert.match(show, /\breveal: o\.reveal\b/);
  assert.match(s, /step\("answer", \{[^}]*reveal: showReply/);
});
