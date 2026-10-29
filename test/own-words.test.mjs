// A rep's own typed words are kept verbatim; the banned-words guard checks only Doors' own words (owner review 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bannedOwn } from "../public/lib/core.js";
import { talkPoints } from "../public/lib/talk.js";
import { draftNote } from "../public/lib/note.js";

test("bannedOwn: a rep's word is theirs; the same word from Doors is still a claim", () => {
  assert.equal(bannedOwn("What I'd ask for is small: a mezcal pour for the bar team.", ["a mezcal pour for the bar team"]), false);
  assert.equal(bannedOwn("They already pour mezcal.", ["a mezcal pour for the bar team"]), true);
  assert.equal(bannedOwn("This room stocks craft beer.", []), true);
});

test("a typed ask with 'pour' stays word for word in the talking points and the drafted note", () => {
  const profile = { brand: "Brasa Verde", what: "small-batch mezcal", ask: "a mezcal pour for the bar team", name: "Dana" };
  const t = talkPoints({ venue: { name: "Kiki", tags: [] }, rank: 1, N: 50, drinkerName: "Casamigos", city: "Chicago", profile }, []);
  assert.equal(t.ask, "a mezcal pour for the bar team");
  // a first note asks for a taste, not the order; the return note after "interested" asks in the rep's own words
  const n = draftNote({ venue: { name: "Kiki" }, profile, cityName: "Chicago", ask: profile.ask, memory: { visit: "return", result: "interested", contact: { name: "Rae" } } });
  assert.match(n.body, /Want to start with a mezcal pour for the bar team\?/);
});

test("'pour-over coffee' as what you make keeps the intro line and the product point", () => {
  const profile = { brand: "Slow Drip", what: "pour-over coffee concentrate", name: "Sam" };
  const n = draftNote({ venue: { name: "Kiki" }, profile, cityName: "Austin" });
  assert.match(n.body, /I'm Sam with Slow Drip, a pour-over coffee concentrate/);
  const t = talkPoints({ venue: { name: "Kiki", tags: [] }, rank: 1, N: 50, drinkerName: "x", city: "Austin", profile }, []);
  assert.ok(t.points.some((p) => /pour-over coffee concentrate/.test(p.text)));
});
