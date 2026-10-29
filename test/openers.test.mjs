// Jard 10-24 #5 (OPENERS-RESEARCH.md, OPENERS-PLAN.md): the opener and the drafted messages, swept over every held
// route. What a rep says out loud never describes the room's crowd or cites the data; a first message asks for a time
// and a taste, never the order; every time a person says is rounded the way people say it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { talkPoints, humanTime } from "../public/lib/talk.js";
import { draftNote, noteFor, SMS_MAX } from "../public/lib/note.js";
import { BANNED_PITCH } from "../public/lib/core.js";
import { route, ROOT } from "./helpers.mjs";

const DIR = join(ROOT, "public/data/routes");
const skip = !existsSync(DIR) && "Qloo's route files are private";
const KEYS = skip ? [] : readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const PROFILES = [
  { brand: "Tidewell", what: "Non-alcoholic hazy IPA", name: "Maya", isNA: true },
  { brand: "Alto Verde", what: "Small-batch mezcal", name: "Dani", isNA: false },
  { brand: "Prairie Fizz", what: "Hard seltzer", name: "Jo", isNA: false },
  { brand: "Hushwater", what: "Sparkling water", name: "Ben", isNA: false },
  { brand: "Zero G", what: "Non-alcoholic gin", name: "Ana", isNA: true },
];
// a said line that describes people or the data: what Jard called "robot" ("looks like your regulars are …")
const DESCRIBES = /\b(looks like|your regulars|regulars are|crowd|young professionals|locals|tourists|enthusiasts|demographic|clientele|Qloo|data|ranks?|#\d)\b/i;

test("every route: the opener and the line for the buyer never describe the room or cite the data; prep names Qloo", { skip }, () => {
  let n = 0;
  const angles = new Set();
  for (const key of KEYS) {
    const r = route(key);
    const ids = r.lists.all.map(([id]) => id).slice(0, 15);
    for (const [k, id] of ids.entries()) {
      const p = PROFILES[k % PROFILES.length];
      const t = talkPoints({ venue: r.venues[id], rank: k + 1, N: ids.length, drinkerName: r.drinker.name, city: r.city.name, profile: p, isNA: p.isNA, eta: 13 * 60 + (k * 17) % 240, day: "tuesday" }, []);
      n++;
      for (const line of [t.opener, t.toBuyer]) {
        assert.ok(line, `${r.venues[id].name}: a line`);
        assert.doesNotMatch(line, DESCRIBES, `${key} ${r.venues[id].name}: "${line}"`);
        assert.doesNotMatch(line, BANNED_PITCH, line);
        assert.ok(line.split(/\s+/).length <= 40, `short enough to say: "${line}"`);
      }
      assert.match(t.opener, /^(Hi|Hey), I'm \w+ with /);
      assert.match(t.opener, /\?/, "the opener asks who buys");
      const angle = t.before.find((x) => /^Your angle: /.test(x));
      // group 3 (Jard web review 10-24): no Qloo tag points at an angle → no angle line (never "Nothing in Qloo's tags …")
      assert.ok(angle || ["na", "soft", "taste"].includes(t.angle.key), "the angle is the rep's prep");
      assert.ok(!angle || !angle.includes("Nothing in Qloo's tags"), angle);
      if (angle && t.angle.src.some((s) => s.field !== "tag:menu_highlight")) assert.match(angle, /Qloo/, "prep names where it came from");
      angles.add(t.angle.key);
      for (const b of t.before) assert.doesNotMatch(b, /\d{1,2}:(?!30\b|00\b)\d\d (am|pm)(?!.*\b(open|close))/i, `prep says an ETA as a person does: "${b}"`);
    }
  }
  assert.ok(n > 400, `${n} rooms`);
  assert.ok(angles.size >= 6, [...angles].join());
});

test("every route: a first message asks for a time and a taste: no crowd line, no product ask, no minutes, a text that fits", { skip }, () => {
  for (const key of KEYS) {
    const r = route(key);
    for (const [k, id] of r.lists.all.map(([x]) => x).slice(0, 10).entries()) {
      const p = PROFILES[k % PROFILES.length];
      const ask = ["one case of cans in the cooler", "one bottle for the back bar", "a sixtel on a rotating line"][k % 3];
      const t = talkPoints({ venue: r.venues[id], profile: p, isNA: p.isNA }, []);
      const n = draftNote({ venue: r.venues[id], profile: { brand: p.brand, what: p.what, pitch: { name: p.name } }, cityName: r.city.name, day: "tuesday", eta: 12 * 60 + (k * 23) % 300, ask, venueType: t.venueType, hook: t.angle?.mail, kind: t.kind });
      const sms = noteFor(n, "sms");
      for (const s of [n.subject, n.body, sms]) {
        assert.doesNotMatch(s, DESCRIBES, `${key}: ${s}`);
        assert.ok(!s.includes(ask), `no product ask: ${s}`);
        assert.doesNotMatch(s, /\d:(?!30)\d\d|~|\b(am|pm)\b/, `a time as a person says it: ${s}`);
        assert.doesNotMatch(s, BANNED_PITCH, s);
      }
      assert.ok(sms.length <= SMS_MAX, sms);
      assert.match(n.body, /no hard feelings if it's not a fit\./);
      assert.match(sms, new RegExp(`^Hi, it's ${p.name} from ${p.brand}`));
    }
  }
});

test("humanTime never says a minute other than :30", () => {
  for (let m = 0; m < 1440; m++) assert.doesNotMatch(humanTime(m, { ampm: true }), /:(?!30)\d\d/, String(m));
});

// personas, final round (fresh outputs): how each kind is tasted, and a return visit that opens from what was logged
test("kinds are tasted the way a buyer would: an NA gin in a drink, water left with the price, a cider pitched for the patio", () => {
  const bar = (tags) => ({ id: "r9", name: "Room", genre: "urn:tag:genre:place:bar", tags });
  const gin = talkPoints({ venue: bar({ bev: ["Cocktails"] }), profile: { brand: "Zero G", what: "Non-alcoholic gin" }, isNA: true }, []);
  assert.match(gin.toBuyer, /Could your bartender make one with tonic, so you taste it the way a guest would\?$/);
  assert.match(draftNote({ venue: {}, profile: { brand: "Zero G", what: "Non-alcoholic gin", pitch: { name: "Ana" } } }).body, /make whoever buys for the bar a quick drink with it\?/);
  const water = talkPoints({ venue: bar({}), profile: { brand: "Hushwater", what: "Canned spring water" } }, []);
  assert.equal(water.toBuyer, "Can I leave you a few cold, and our price per can?");
  assert.match(draftNote({ venue: {}, profile: { brand: "Hushwater", what: "Canned spring water", pitch: { name: "Ben" } } }).body, /drop off a few cold ones for whoever buys for the bar, with our price\?/);
  const patioRoom = { ...bar({ interests: ["Patio culture"] }), lat: 41.9 }; // Chicago
  const cider = talkPoints({ venue: patioRoom, profile: { brand: "Hollow Oak", what: "Dry craft cider" }, date: "2026-07-14" }, []);
  assert.equal(cider.toBuyer, "It's a dry craft cider for the patio. Can I pour you one cold?");
  // proof re-judge 10-24: not in late October in Chicago, and not with no visit date
  assert.equal(talkPoints({ venue: patioRoom, profile: { brand: "Hollow Oak", what: "Dry craft cider" }, date: "2026-10-27" }, []).angle.key, "taste");
  assert.equal(talkPoints({ venue: patioRoom, profile: { brand: "Hollow Oak", what: "Dry craft cider" } }, []).angle.key, "taste");
  assert.equal(talkPoints({ venue: { ...patioRoom, lat: 30.3 }, profile: { brand: "Hollow Oak", what: "Dry craft cider" }, date: "2026-10-27" }, []).angle.key, "patio", "Austin in October is");
  assert.equal(cider.angle.mail, "I think it'd be a good one for your patio.");
});

test("a return visit opens from what was logged: the owner, the price, interested; never 'think it over?'", () => {
  const v = { id: "r9", name: "Room", genre: "urn:tag:genre:place:bar" };
  const p = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", ask: "one case of cans in the cooler" };
  const open = (memory) => talkPoints({ venue: v, profile: p, isNA: true, memory: { visit: "return", contact: { name: "Jess" }, ...memory } }, []).opener;
  assert.equal(open({ objection: { kind: "owner" } }), "Good to see you again, Jess. Is the owner in today, or should I come back when they are?");
  assert.equal(open({ objection: { kind: "price" } }), "Good to see you again, Jess. I brought the price sheet, so we can look at the numbers together.");
  assert.equal(open({ result: "interested" }), "Good to see you again, Jess. I brought a couple of cold ones for you and the team. Want to try one?");
  assert.equal(open({ result: "interested", said: "liked it, wants to try it on the patio" }), "Good to see you again, Jess. I brought a couple of cold ones for you and the team. Want to try one out on the patio?", "the taste first; the case after it");
  assert.equal(open({ result: "followup" }), "Good to see you again, Jess. I brought a couple of cold ones for you and the team.");
  const mez = talkPoints({ venue: v, profile: { brand: "Alto Verde", what: "Small-batch mezcal" }, memory: { visit: "return", contact: null, result: "followup" } }, []).opener;
  assert.equal(mez, "Good to see you again. I brought a bottle to pour for the team.");
  const note = draftNote({ venue: v, profile: { brand: "Alto Verde", what: "Small-batch mezcal", pitch: { name: "Dani" } }, memory: { visit: "return", contact: { name: "Chris" }, result: "followup", objection: { kind: "owner" } } });
  assert.match(note.body, /Happy to meet the owner too, if they're around\./);
  assert.match(note.body, /I'll bring a bottle and pour for the team\./);
  assert.doesNotMatch(note.body, /so the team can taste it/);
});
