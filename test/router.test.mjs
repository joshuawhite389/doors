// The /app hash router: #/new, #/demo, #/plan, #/edit; unknown → #/new; guard redirects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHash, hrefFor, createRouter, ROUTES } from "../public/lib/router.js";

test("parseHash knows the routes and their params", () => {
  assert.deepEqual(ROUTES, ["new", "demo", "plan", "edit", "brand", "cities", "city"]); // group 3 #5: Edit my brand, My cities, a city
  assert.deepEqual(parseHash("#/new"), { name: "new", params: {}, known: true });
  assert.deepEqual(parseHash("#/demo"), { name: "demo", params: {}, known: true });
  assert.deepEqual(parseHash("#/plan?day=2026-10-13"), { name: "plan", params: { day: "2026-10-13" }, known: true });
  assert.equal(parseHash("#/plan/").name, "plan");
  // a saved plan, and the edit route that loads its profile into the form
  assert.deepEqual(parseHash(hrefFor("plan", { brand: "Señor Tide & Co", city: "austin" })).params, { brand: "Señor Tide & Co", city: "austin" });
  assert.deepEqual(parseHash("#/edit?brand=Tidewell&city=austin&copy=1"), { name: "edit", params: { brand: "Tidewell", city: "austin", copy: "1" }, known: true });
  assert.deepEqual(parseHash("#/new?blank=1").params, { blank: "1" });
});

test("parseHash sends anything unknown or empty to the profile", () => {
  for (const h of ["", "#", "#/", "#/nope", "#plan", "/plan", null, undefined, "#/PLAN"]) {
    const r = parseHash(h);
    assert.equal(r.name, "new", String(h));
    assert.equal(r.known, false, String(h));
  }
});

test("hrefFor builds hashes and refuses unknown routes", () => {
  assert.equal(hrefFor("plan"), "#/plan");
  assert.equal(hrefFor("plan", { day: "2026-10-13" }), "#/plan?day=2026-10-13");
  assert.throws(() => hrefFor("admin"));
});

function fakeWin(hash) {
  const ls = new Set();
  const win = {
    location: { hash },
    history: { replaceState: (_s, _t, h) => { win.location.hash = h; } },
    addEventListener: (_e, f) => ls.add(f),
    removeEventListener: (_e, f) => ls.delete(f),
    nav(h) { win.location.hash = h; ls.forEach((f) => f()); },
    listeners: ls,
  };
  return win;
}

test("createRouter resolves now, follows hash changes, and canonicalises unknown hashes", () => {
  const win = fakeWin("#/whatever");
  const seen = [];
  const r = createRouter(win, { onRoute: (x) => seen.push(x.name) });
  assert.deepEqual(seen, ["new"]);
  assert.equal(win.location.hash, "#/new");
  win.nav("#/demo");
  assert.deepEqual(seen, ["new", "demo"]);
  assert.equal(r.current().name, "demo");
  r.stop();
  assert.equal(win.listeners.size, 0);
});

test("the guard redirects #/plan to #/new when there is no profile, and lets it through once there is", () => {
  const win = fakeWin("#/plan");
  let hasProfile = false;
  const seen = [];
  const r = createRouter(win, { onRoute: (x) => seen.push(x), guard: (x) => (x.name === "plan" && !hasProfile ? "new" : null) });
  assert.equal(seen[0].name, "new");
  assert.equal(seen[0].redirectedFrom, "plan");
  assert.equal(win.location.hash, "#/new");
  hasProfile = true;
  win.location.hash = "#/plan"; // go() sets the hash; the browser then fires hashchange
  win.nav("#/plan");
  assert.equal(seen.at(-1).name, "plan");
  r.stop();
});

test("a guard can send a saved plan that is not there back to the form", () => {
  const saved = new Set(["Tidewell|austin"]);
  const guard = (x) => (x.name === "plan" && x.params.brand && !saved.has(`${x.params.brand}|${x.params.city}`) ? "new" : null);
  const win = fakeWin("#/plan?brand=Gone&city=austin");
  const seen = [];
  const r = createRouter(win, { onRoute: (x) => seen.push(x), guard });
  assert.equal(seen[0].name, "new");
  win.nav("#/plan?brand=Tidewell&city=austin");
  assert.deepEqual(seen.at(-1).params, { brand: "Tidewell", city: "austin" });
  r.stop();
});
