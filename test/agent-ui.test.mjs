// Doors Agent's panel (spec §5–6, step 5): the greeting with no suggestion chips, a
// change chip per change with its own Undo, quieter source tags, the screen's mode, and who speaks the reply.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { greeting, modeOf, sourceTag, changeSet, chipsOf, chipsText } from "../public/lib/agent-ui.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("greeting: 'Hi [first name], how can I help?' from the profile's 'Sign your notes as'", () => {
  assert.equal(greeting({ pitch: { name: "Jard White" } }), "Hi Jard, how can I help?");
  assert.equal(greeting({ pitch: { name: "  " } }), "Hi, how can I help?");
  assert.equal(greeting(null), "Hi, how can I help?");
});

test("mode by screen: drive mode, else a stop, else the plan", () => {
  assert.equal(modeOf({ driving: true, stop: true }), "drive");
  assert.equal(modeOf({ stop: true }), "stop");
  assert.equal(modeOf({}), "plan");
});

test("source tags: Qloo / route / you / link (a link keeps its url), Doors for the talking points", () => {
  assert.deepEqual(sourceTag({ kind: "qloo", label: "Qloo (customer demographics)" }), { tag: "Qloo", url: null, title: "Qloo (customer demographics)" });
  assert.equal(sourceTag({ kind: "plan", label: "Doors' route" }).tag, "route");
  assert.equal(sourceTag({ kind: "stated" }).tag, "you");
  assert.equal(sourceTag({ kind: "corrected" }).tag, "you");
  const web = sourceTag({ kind: "web", label: "example.com", url: "https://example.com/menu", title: "Menu" });
  assert.deepEqual(web, { tag: "link", url: "https://example.com/menu", title: "Menu" });
  assert.equal(sourceTag({ kind: "web", url: "javascript:alert(1)" }).url, null); // only http(s) opens
  assert.equal(sourceTag({ kind: "doors" }).tag, "Doors");
  assert.equal(sourceTag(undefined).tag, "Doors");
});

test("change chips: one per change; a group's Undo runs newest first; the group's chips go together", async () => {
  const ran = [];
  const cs = changeSet();
  cs.undo("plan", () => ran.push("snapshot")); // registered first, runs last
  cs.add("Meanwhile moved to Friday", "plan");
  cs.undo("plan", () => ran.push("replan"));
  cs.add("Changed the opener for Meanwhile", "c0");
  cs.undo("c0", () => ran.push("talk"));
  cs.add("", "c1"); // nothing to say: no chip
  assert.deepEqual(cs.chips, [{ text: "Meanwhile moved to Friday", g: "plan" }, { text: "Changed the opener for Meanwhile", g: "c0" }]);
  const fns = cs.undos;
  await fns.get("plan")();
  assert.deepEqual(ran, ["replan", "snapshot"]);
  await fns.get("c0")();
  assert.deepEqual(ran, ["replan", "snapshot", "talk"]);
  assert.equal(chipsText(cs.chips), "Meanwhile moved to Friday · Changed the opener for Meanwhile");
});

test("a chat kept before chips (did: 'a · b') still shows its changes, without Undo", () => {
  assert.deepEqual(chipsOf({ did: "Skipped Meanwhile · Kept for Meanwhile: contact Dana" }), [{ text: "Skipped Meanwhile", g: null }, { text: "Kept for Meanwhile: contact Dana", g: null }]);
  assert.deepEqual(chipsOf({ chips: [{ text: "x", g: "c0", undone: true }] }), [{ text: "x", g: "c0", undone: true }]);
  assert.deepEqual(chipsOf({}), []);
});

test("web panel: the greeting and no suggestion chips; the mode goes with every ask; the speaker tap and drive mode speak", () => {
  const ui = read("public/ui/agent.js");
  assert.doesNotMatch(ui, /data-sugg|SUGG|asugg/);
  assert.match(ui, /greeting\(S\.getPlan\(\)\?\.profile\)/);
  assert.match(ui, /mode: asMode \}/);
  assert.match(ui, /data-agent="say"/);
  assert.match(ui, /sayAgent\(messages\[/);
  assert.match(ui, /data-agent="undo" data-g=/);
  const drive = read("public/ui/drive.js");
  assert.match(drive, /e\.detail\?\.mode === "drive"[^\n]*sayAgent\(e\.detail\.reply/);
  assert.match(drive, /removeEventListener\("doors:agent-reply", onAgentReply\)/);
});

test("phone: the same greeting and no suggestions; Drive sends mode drive and speaks; the stop sends stop", () => {
  const chat = read("app-mobile/src/components/ChatView.tsx");
  assert.doesNotMatch(chat, /SUGGESTIONS|suggestions[=.]|suggestions\.map/);
  assert.match(chat, /greeting\(/);
  // Jard 10-23: all phone speech in the Aura-2 voice: the 🔊 tap goes to src/voice.ts (device voice only as its fallback)
  assert.match(chat, /import \{ speak \} from "\.\.\/voice"/);
  assert.match(chat, /onPress=\{\(\) => speak\(item\.text, \{ offline: !!chat\.offline \}\)\}/); // the tour never calls the Worker's voice
  assert.doesNotMatch(chat, /expo-speech/);
  const agent = read("app-mobile/src/agent.ts");
  assert.match(agent, /mode: MODES\.includes\(mode\) \? mode : "plan"/);
  const drive = read("app-mobile/src/screens/Drive.tsx");
  assert.match(drive, /mode: "drive"/);
  const ask = read("app-mobile/src/screens/Ask.tsx");
  assert.match(ask, /mode: params\.current \? "stop" : "plan"/);
});
