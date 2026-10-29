// What your plan is based on (lib/basis.js, Jard 10-23 #2/#7): the demo plan's facts, in plain words, each door's
// way through the gates, and fixes that are only the plan's own actions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { route, readJson } from "./helpers.mjs";
import { sieve } from "../public/lib/sieve.js";
import * as I from "../public/lib/insights.js";
import { basis, doorTrail, findDoors, BASIS_BUTTON, BASIS_TITLE, WHY_DOOR } from "../public/lib/basis.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix } from "../public/lib/demo-plan.js";

const austin = route("athletic-brewing-austin");
const demo = readJson("public/data/demo/demo.json");
const city = readJson("public/data/cities/austin.json");

async function ctxFor({ famous = false } = {}) {
  const profile = demoProfile();
  const { states } = await demoStates({ routes: [austin], profile, contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix) });
  const { plan: p, pool } = states[0];
  const plan = { ...p, venues: pool.venues, statuses: pool.statuses };
  const venues = { ...austin.venues, ...plan.venues };
  const sv = sieve({ route: austin, plan, profile, famous, city });
  const cv = I.curve(austin, plan.pool?.ids ?? pool.ids, { famous });
  const ids = cv.rows.map((r) => r.id);
  return { sv, cv, plan, profile, venues, famous, hasFamous: true, cityName: "Austin", talk: city.talk.venues, pop: I.popularity(austin, cv.rows, venues), crowd: I.crowd(ids.slice(0, 50), venues), sound: I.sound(ids, city.sounds ?? {}), funnel: I.funnel(austin, {}) };
}

const FIX_KINDS = new Set(["status", "add", "famous", "profile", "agent", "rule"]);

test("basis: the demo plan's facts, grouped, every door on the plan listed once, fixes are plan actions", async () => {
  const ctx = await ctxFor();
  const b = basis(ctx);
  assert.deepEqual(b.groups.map((g) => g.key), ["mine", "plan", "out", "city", "settings"]);
  // intuitiveness audit #8: door types and days aren't a second Settings here; only the famous-doors switch stays
  assert.deepEqual(b.groups.find((g) => g.key === "settings").facts.map((f) => f.key), ["famous"]);
  assert.equal(b.groups.find((g) => g.key === "settings").title, "Most popular doors");
  const onPlan = new Set(ctx.plan.days.flatMap((d) => d.stops.map((s) => s.id)));
  const listed = b.groups.find((g) => g.key === "plan").facts.map((f) => f.door);
  assert.deepEqual([...new Set(listed)].sort(), [...onPlan].sort());
  assert.equal(b.steps.at(-1).n, onPlan.size);
  assert.match(b.groups.find((g) => g.key === "plan").facts[0].text, /^Nomadic Beerworks is #1 of 55 on Your list/);
  // ease audit #6: no Qloo 0–1 numbers (affinity, popularity, rank correlation) anywhere on the screen's list or a door's view
  const words = [b.intro, ...b.steps.map((st) => st.label), ...b.groups.flatMap((g) => g.facts.flatMap((f) => [f.text, f.more ?? ""]))];
  for (const d of [...ctx.sv.dots, ...ctx.sv.extras].slice(0, 80)) { const t = doorTrail(d, ctx); if (t) words.push(t.head, ...t.lines.map((l) => l.text)); }
  for (const w of words) assert.doesNotMatch(w, /\b0\.\d|affinity|correlation|popularity of/i, w);
  assert.equal(b.steps.length, 3);
  assert.equal(b.steps[1].n, 55, "the middle tile is Your list's count (Your list · 55)");
  const out = b.groups.find((g) => g.key === "out").facts;
  assert.match(out[0].text, /^23 most popular doors left for later/);
  assert.ok(out.some((f) => /Hi Hat Public House .* restaurant .* you pitch bars and breweries/.test(f.text)));
  for (const g of b.groups) for (const f of g.facts) for (const x of f.fixes) assert.ok(FIX_KINDS.has(x.kind), `${f.key}: ${x.kind}`);
  // the demo's known door is under Your corrections, with its undo
  const mine = b.groups.find((g) => g.key === "mine").facts;
  assert.ok(mine.some((f) => f.fixes[0]?.kind === "status" && f.fixes[0].status === null));
});

test("basis: a door's trail passes every gate on the plan, and stops at the gate that left it out", async () => {
  const ctx = await ctxFor();
  const on = ctx.sv.dots.find((d) => d.fate === "plan" && d.rank);
  const t = doorTrail(on, ctx);
  assert.equal(t.lines.length, 4, "kind, new to you, open, on the plan: the famous and door-type gates only say back the rep's settings");
  assert.ok(t.lines.every((l) => l.ok));
  assert.doesNotMatch(t.lines[0].text, /\((\w+)\)/, "no type said twice ('A bar (bar)')");
  for (const l of t.lines) assert.doesNotMatch(l.text, /best-known|You pitch/, l.text);
  assert.match(t.lines.at(-1).text, /^On your plan: \w+day, stop \d+ of \d+$/);
  assert.deepEqual(t.fixes.map((f) => f.label), ["Already a customer", "Not a fit", "Ask"]);
  // Jard 10-24: a plain Remove, no reason asked, where the screen can do it (the web; the phone has no handler yet)
  assert.deepEqual(doorTrail(on, { ...ctx, removable: true }).fixes.map((f) => f.label), ["Already a customer", "Not a fit", "Remove from my plan", "Ask"]);
  const room = ctx.sv.dots.find((d) => d.fate === "room" && d.code === "restaurants");
  const r = doorTrail(room, ctx);
  assert.equal(r.lines.filter((l) => !l.ok).length, 1);
  assert.equal(r.lines.at(-1).ok, false);
  assert.ok(r.fixes.some((f) => f.kind === "add"));
  const fam = doorTrail(ctx.sv.dots.find((d) => d.fate === "famous"), ctx);
  assert.ok(fam.fixes.some((f) => f.kind === "famous" && f.on === true));
  assert.ok(findDoors(ctx.sv, "growler").some((d) => d.name === "Growler Express"));
});

test("basis: plain words (GLOSSARY Voice): no taglines, no 'brain', no old names", async () => {
  const ctx = await ctxFor();
  const b = basis(ctx);
  const names = [...ctx.sv.dots, ...ctx.sv.extras].map((d) => d.name).sort((x, y) => y.length - x.length);
  const words0 = [BASIS_BUTTON, BASIS_TITLE, WHY_DOOR, b.intro, ...b.groups.flatMap((g) => [g.title, ...g.facts.flatMap((f) => [f.text, f.more, ...f.fixes.map((x) => x.label)])])].join("\n");
  const words = names.reduce((w, n) => w.split(n).join("<door>"), words0);
  for (const bad of [/brain/i, /sleeper/i, /too famous/i, /doubting/i, /\brooms?\b/i, /\bvenues?\b/i, /not by who's famous/i]) assert.doesNotMatch(words, bad);
  for (const f of ["public/lib/basis.js", "public/ui/why.js", "app-mobile/src/screens/Why.tsx"]) assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /brain/i, f);
});

test("basis (Jard 10-24): a room you added that no day holds offers Remove, not Add; Changes you made has its Remove", async () => {
  const ctx = await ctxFor();
  const d = ctx.sv.dots.find((x) => x.fate === "open" || x.fate === "route");
  const venues = { ...ctx.plan.venues, [d.id]: { ...(ctx.plan.venues[d.id] ?? d.venue ?? {}), added: true } };
  const c = { ...ctx, removable: true, plan: { ...ctx.plan, venues }, venues: { ...(ctx.venues ?? {}), [d.id]: venues[d.id] }, added: [d.id] };
  assert.deepEqual(doorTrail(d, c).fixes.map((f) => f.kind), ["remove"]);
  const mine = basis(c).groups.find((g) => g.key === "mine").facts.find((f) => f.key === `a-${d.id}`);
  assert.deepEqual(mine.fixes.map((f) => f.label), ["Remove from my plan"]);
  assert.deepEqual(basis({ ...c, removable: false }).groups.find((g) => g.key === "mine").facts.find((f) => f.key === `a-${d.id}`).fixes, []);
});

// Jard web review R2 (10-24, imgs 201440–201620): "What to say" on Why this door showed the stored model lead ("Looks
// like you get a lot of craft beer enthusiasts and young professionals in here."), a line the opener retired. It is the
// stop's own opener and buyer line now, or nothing.
test("Why this door: What to say is the stop's opener, never a stored 'Looks like …' lead", async () => {
  const { stopModel } = await import("../public/lib/stopmodel.js");
  const ctx = await ctxFor();
  const on = ctx.sv.dots.filter((d) => d.fate === "plan" && d.rank);
  assert.ok(on.length > 3);
  for (const d of on) assert.equal(doorTrail(d, ctx).say, null, `${d.name}: no talkFor → nothing, not the stored lead`);
  const dayOf = I.dayOfId(ctx.plan);
  const talkFor = (id) => stopModel({ plan: ctx.plan, id, dayIndex: dayOf.get(id) ?? null, city }).talk;
  for (const d of on) {
    const t = doorTrail(d, { ...ctx, talkFor });
    const real = talkFor(d.id);
    assert.equal(t.say, real.opener, d.name);
    assert.equal(t.toBuyer, real.toBuyer ?? null, d.name);
    assert.doesNotMatch(`${t.say} ${t.toBuyer ?? ""}`, /looks like (you get|your regulars)|in here\b/i, d.name);
  }
  const off = ctx.sv.dots.find((d) => d.fate !== "plan");
  assert.equal(doorTrail(off, { ...ctx, talkFor }).say, null, "a door off the plan has no opener to show");
});

test("round 4 #6: a Settings form's save sits in Changes you made as a Settings change, with Undo", async () => {
  const ctx = await ctxFor();
  const whyChanges = [
    { id: "w1", kind: "rooms", key: null, text: "Pitch restaurants too", from: ["bars"], change: { kind: "rooms", rooms: ["bars", "restaurants"] } },
    { id: "p1", kind: "profile", key: "p1", text: "Time at each door: 30 min", from: ctx.profile, change: { kind: "profile", profile: { ...ctx.profile, visitMin: 30 }, text: "Time at each door: 30 min", key: "p1" } },
  ];
  const mine = basis({ ...ctx, whyChanges }).groups.find((g) => g.key === "mine").facts;
  const why = mine.find((f) => f.key === "w-w1"), set = mine.find((f) => f.key === "w-p1");
  assert.equal(why.more, `You changed this on ${BASIS_BUTTON}.`);
  assert.equal(set.text, "Time at each door: 30 min.");
  assert.equal(set.more, "You changed this in Settings.");
  assert.deepEqual(set.fixes, [{ kind: "whyundo", id: "p1", label: "Undo" }]);
});
