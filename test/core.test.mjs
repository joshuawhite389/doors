// Food-and-drink filter and the set-overlap strip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFoodAndDrink, overlap, overlapSentence } from "../public/lib/core.js";
import { strip } from "./helpers.mjs";

const G = (g, name = "Somewhere") => ({ genre: `urn:tag:genre:place:${g}`, name });

test("isFoodAndDrink drops rooms that do not pour", () => {
  for (const [g, name] of [
    ["golf_course", "Butler Pitch & Putt"],
    ["grocery_store", "H-E-B"],
    ["pet_store", "Tomlinson's Feed"],
    ["restaurant:ice_cream_shop", "Lick Honest Ice Creams"],
    ["restaurant:fast_food", "Whataburger"],
    ["restaurant:banquet_hall", "The Allan House"],
  ]) {
    assert.equal(isFoodAndDrink(G(g, name)), false, `${g} (NA)`);
    assert.equal(isFoodAndDrink(G(g, name), { alcohol: true }), false, `${g} (alcohol)`);
  }
});

test("isFoodAndDrink keeps breweries, cocktail bars, hotels and music rooms", () => {
  for (const g of ["brewery", "restaurant:cocktail_bar", "hotel", "live_music_venue", "restaurant:brewpub", "restaurant:live_music_bar"]) {
    assert.equal(isFoodAndDrink(G(g)), true, `${g} (NA)`);
    assert.equal(isFoodAndDrink(G(g), { alcohol: true }), true, `${g} (alcohol)`);
  }
  assert.equal(isFoodAndDrink({ name: "No genre" }), true, "no category: kept");
});

// Orchestrator ruling (M2): bakeries, groceries, banquet halls and coffee-only rooms are dropped for every drinker;
// a coffee shop stays only when its name says it pours, whatever the alcohol flag. Cafés stay.
const BOTH = [{ alcohol: false }, { alcohol: true }];

test("bakeries, groceries (incl. grocery chains in a restaurant genre) and banquet halls are dropped for every drinker", () => {
  for (const v of [
    G("restaurant:bakery", "Quack's 43rd Street Bakery"),
    G("bakery", "Upper Crust Bakery"),
    G("restaurant:bakery", "Hy-Vee Bakery"),
    G("restaurant:american", "Hy-Vee Market Grille"),
    G("restaurant:deli", "Whole Foods Market Deli"),
    G("restaurant", "HEB Mueller Café"),
    G("grocery_store", "Central Market"),
    G("supermarket", "Randalls"),
    G("banquet_hall", "Grand Ballroom Banquets"),
    G("restaurant:banquet_hall", "The Allan House"),
  ]) for (const o of BOTH) assert.equal(isFoodAndDrink(v, o), false, `${v.name} (${v.genre}) alcohol=${o.alcohol}`);
});

test("coffee shops: kept only when the name pours, regardless of the alcohol flag", () => {
  for (const o of BOTH) {
    assert.equal(isFoodAndDrink(G("restaurant:coffee_shop", "Flitch Coffee"), o), false, `Flitch alcohol=${o.alcohol}`);
    assert.equal(isFoodAndDrink(G("restaurant:coffee_shop", "Merit Coffee"), o), false, `Merit alcohol=${o.alcohol}`);
    assert.equal(isFoodAndDrink(G("restaurant:tea_house", "Zhi Tea"), o), false, `tea house alcohol=${o.alcohol}`);
    assert.equal(isFoodAndDrink(G("restaurant:coffee_shop", "Radio Coffee & Beer"), o), true, `Radio alcohol=${o.alcohol}`);
    assert.equal(isFoodAndDrink(G("restaurant:coffee_shop", "Cosmic Coffee + Beer Garden"), o), true, `Cosmic alcohol=${o.alcohol}`);
    assert.equal(isFoodAndDrink(G("restaurant:coffee_shop", "Café No Sé Wine & Cocktails"), o), true, `wine alcohol=${o.alcohol}`);
  }
});

test("cafés: a café-named coffee house is not a door; a restaurant that happens to be a café genre is", () => {
  for (const o of BOTH) {
    assert.equal(isFoodAndDrink(G("restaurant:cafe", "Café Medici"), o), false, "a café-named coffee house (Diolosa R2)");
    assert.equal(isFoodAndDrink(G("restaurant:art_cafe", "Sunshine Spice Bakery & Cafe"), o), false, "bakery in the name");
    assert.equal(isFoodAndDrink(G("restaurant:cafe", "Elm Street Bistro"), o), true, "a café-genre room without café/coffee in the name");
    assert.equal(isFoodAndDrink(G("restaurant:vietnamese", "Elizabeth Street Café"), o), true, "only restaurant:cafe is tested by the café name");
    assert.equal(isFoodAndDrink(G("restaurant:cafe", "Better Half Coffee & Cocktails"), o), true, "pours");
    assert.equal(isFoodAndDrink(G("restaurant:american", "Panera Bread"), o), false);
    assert.equal(isFoodAndDrink(G("restaurant:american", "Boise Boba"), o), false);
    assert.equal(isFoodAndDrink(G("restaurant:american", "The Garage Bar & Sandwiches"), o), true, "a real bar word rescues");
    assert.equal(isFoodAndDrink({ genre: "urn:tag:genre:place:restaurant:bar", name: "Bubbles", address: "10000 W O'Hare Ave, Chicago" }, o), false, "airport");
    assert.equal(isFoodAndDrink({ genre: "urn:tag:genre:place:restaurant:seafood", name: "Mr. Catfish", address: "6900 Airport Blvd, Austin" }, o), true, "an Airport Blvd street is not an airport");
  }
});

test("coffee-only rooms whose name says 'bar', 'lounge' or 'brew' are still coffee-only", () => {
  for (const o of BOTH) {
    assert.equal(isFoodAndDrink(G("restaurant:coffee_shop", "Stir Coffee Bar"), o), false, "Stir Coffee Bar");
    assert.equal(isFoodAndDrink(G("restaurant:coffee_shop", "Lola Savannah Coffee Lounge - Westlake"), o), false, "Coffee Lounge");
    assert.equal(isFoodAndDrink(G("restaurant:coffee_roastery", "Treasure Valley Coffee INC. Offices"), o), false, "roastery");
    assert.equal(isFoodAndDrink(G("restaurant:bubble_tea_store", "Teapioca Lounge"), o), false, "bubble tea");
  }
});

test("event venues need a pour word in the name", () => {
  assert.equal(isFoodAndDrink(G("event_venue", "Barton Creek Event Center")), false);
  assert.equal(isFoodAndDrink(G("event_venue", "The Tap Room at Hops")), true);
});

test("overlap counts duplicates once and is symmetric", () => {
  assert.equal(overlap(["a", "a", "b", "c"], ["a", "c", "c", "d"]), 2);
  assert.equal(overlap(["a", "c", "c", "d"], ["a", "a", "b", "c"]), 2);
  assert.equal(overlap([], ["a"]), 0);
  assert.equal(overlap(["x", "y"], ["x", "y"]), 2);
  assert.equal(overlapSentence("Casamigos", "Athletic Brewing", 6), "Casamigos shares 6 of 50 doors with Athletic Brewing");
});

for (const cityKey of ["austin", "boise", "chicago", "omaha"]) {
  test(`strip/${cityKey}.json matrix equals overlap() for every brand pair`, () => {
    const s = strip(cityKey);
    const keys = Object.keys(s.brands);
    let pairs = 0;
    for (const a of keys) {
      for (const b of keys) {
        if (a === b) continue;
        const v = s.matrix[`${a}|${b}`] ?? s.matrix[`${b}|${a}`];
        assert.equal(typeof v, "number", `matrix has ${a}|${b}`);
        assert.equal(overlap(s.brands[a].ids, s.brands[b].ids), v, `${a}|${b}`);
        assert.equal(overlap(s.brands[b].ids, s.brands[a].ids), v, `${b}|${a} symmetric`);
        pairs++;
      }
    }
    assert.equal(pairs, keys.length * (keys.length - 1));
  });
}
