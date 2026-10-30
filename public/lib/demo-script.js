// The guided demo's steps, in order (ui/demo.js runs them; test/demo.test.mjs checks the list). Each step is a card
// that points at one part of the real app:
//   act "continue": the visitor reads it and presses Continue
//   act "click":    the visitor does the step in the app (the card says what to click; "Do it for me" is there too)
//   act "wait":     the app is working (the route draws itself); the card moves on when it's done
//   act "end":      the hand-off: the controls are theirs
// `body` is paragraphs; "{toast}" is filled in at run time with what the app said. Pure: no DOM.
export const STEPS = [
  // Round 8 (Jard 10-28): a card is read at a glance or skimmed: one point, at most ~35 words (test/demo.test.mjs).
  // ---------- the profile ----------
  {
    key: "intro", phase: "profile", act: "continue", title: "Meet Maya",
    body: [
      "Maya Ortiz makes Tidewell, a non-alcoholic IPA. She has three afternoons in Austin next week to get it onto menus.",
      "First, her brand profile.",
    ],
  },
  {
    key: "drinker", phase: "profile", act: "continue", title: "Who drinks it",
    body: [
      "Maya names a brand her customers already drink: Athletic Brewing.",
      "Qloo's taste data ranks every Austin bar by how well its regulars match Athletic Brewing drinkers.",
    ],
  },
  {
    key: "day", phase: "profile", act: "continue", title: "Where and when",
    body: [
      "Each day is a driving loop from East Austin.",
      "Tuesday, Wednesday and Thursday afternoons. Doors books only bars open when she'd arrive, 25 minutes a stop.",
    ],
  },
  {
    key: "pitch", phase: "profile", act: "continue", title: "Her pitch, and doors to skip",
    body: [
      "Her price, ask and tasting offer feed every stop's talking points.",
      "Central District Brewing is under Doors to skip. BBG's, her contact, was added with + Add a door and always gets a stop.",
    ],
  },
  {
    key: "build", phase: "profile", act: "click", title: "Her profile is ready", cta: "Click Build my plan",
    body: ["Doors ranks Austin's bars for Athletic Brewing drinkers, keeps the ones open when she's out, and routes each day on real roads."],
  },
  // ---------- the plan ----------
  {
    key: "building", phase: "plan", act: "wait", title: "Building her plan",
    body: ["Ranking Austin's bars, then routing Tuesday from East Austin."],
  },
  {
    key: "tuesday", phase: "plan", act: "continue", title: "Tuesday's route",
    body: [
      "Her stops in driving order, all open when she arrives.",
      "Each one says who drinks there, from Qloo. The map draws the same route.",
    ],
  },
  {
    key: "askwhy", phase: "plan", act: "click", title: "Ask Doors Agent why", cta: "Click Send",
    body: [
      "Maya's question is typed in: Nomadic Beerworks is #1, so why isn't it her first stop?",
      "Doors Agent answers live, from her plan and Qloo's data.",
    ],
  },
  {
    key: "answer", phase: "plan", act: "continue", title: "An answer with its sources",
    body: [
      "Every fact names its source: Qloo's data and its date, the route, or what she told Doors.",
      "The chat can also change the plan, and Undo takes it back.",
    ],
  },
  {
    key: "week", phase: "plan", act: "click", title: "Three days, three routes", cta: "Click All days",
    body: ["Maya has three afternoons in Austin. All days shows them at once."],
  },
  {
    key: "open", phase: "plan", act: "click", title: "Her #1 door", cta: "Click Nomadic Beerworks",
    body: [
      "Each day is its own color. BBG's lands on Thursday, the only day it's open.",
      "Nomadic Beerworks is #1 for Athletic Brewing drinkers. Open it to see what Doors prepared.",
    ],
  },
  {
    key: "why", phase: "plan", act: "continue", title: "Why it's on her list",
    body: ["Lower on the card: About this door is Qloo's profile of its crowd. Why this door says why it's #1 for her."],
  },
  {
    key: "talk", phase: "plan", act: "continue", title: "What to say at the door",
    body: [
      // judge 12 #3: the card names the buyer line, not where it came from
      "Who to ask for, her opener, the line for the buyer, her ask, what to bring.",
      "Questions, pushback and a message signed by Maya are one tap away.",
    ],
  },
  {
    key: "shorter", phase: "plan", act: "click", title: "A shorter opener", cta: "Click Send",
    body: ["A line she can say in one breath. Doors rewrites only that line, with Undo."],
  },
  {
    key: "visit", phase: "plan", act: "click", title: "She goes there first", cta: "Click Log visit",
    // judge 11 #4 / 12 #4: the plan's place and time for the door, in the door card's own words (read from the built
    // plan: demo.test "the tour's visit line"), so the card's timing tip and the story agree
    body: ["Maya starts Tuesday at Nomadic, though the plan has it as stop 6, around 3:30 pm. Log the visit and Tuesday re-routes from it."],
  },
  {
    key: "outcome", phase: "plan", act: "click", title: "How it went", cta: "Click Save outcome",
    body: ["Most outcomes are one tap. This one has details, filled in: Sam, the bar manager; Interested; follow up Thursday; a note on price."],
  },
  {
    key: "replan", phase: "plan", act: "continue", title: "The days ahead re-plan",
    body: [
      "Tuesday now opens with it and re-routes from there. {toast}",
      "Every logged visit re-plans the days still ahead.",
    ],
  },
  {
    key: "back", phase: "plan", act: "continue", title: "Thursday: the follow-up visit",
    body: ["Same door, two days later. The highlighted lines changed from what she logged: ask for Sam, skip the pitch they heard, answer price first, a shorter note."],
  },
  // ---------- owner review 9 ----------
  {
    key: "drive", phase: "plan", act: "click", title: "In the car", cta: "Click Start my day",
    body: [
      "Back to Tuesday, after Nomadic. On the road the plan is one door at a time: who, why, what to say, and Navigate.",
      "Doors Agent listens at the bottom: ask it out loud.",
    ],
  },
  {
    key: "done", phase: "plan", act: "click", title: "Log visit by voice", cta: "Click Log visit",
    body: [
      "Her next door is {door}. One big button: she says how it went, nothing to type.",
      "The demo types it for her. You can say it instead.",
    ],
  },
  {
    key: "save", phase: "plan", act: "click", title: "Read back, then the next door", cta: "Click Save & next door",
    body: [
      "Doors reads it back: an outcome, a follow-up time and a note in her words.",
      "Save files it and moves her on, with Undo. Thursday re-plans around the 3 pm follow-up at {door}.",
    ],
  },
  {
    key: "swap", phase: "plan", act: "continue", title: "Same brand, new city",
    body: ["Each city is planned from Qloo's data for it. In Boise the #1 door for Athletic Brewing drinkers is a different bar. {toast}"],
  },
  {
    key: "handoff", phase: "plan", act: "end", title: "Explore on your own",
    body: ["{toast} Those were the highlights. Everything on this page works. Try one of these, or start your own profile."],
  },
];

export const ACTS = ["continue", "click", "wait", "end"];
export const stepAt = (key) => STEPS.findIndex((s) => s.key === key);
// the numbered steps in the banner: everything but the hand-off
export const COUNTED = STEPS.filter((s) => s.act !== "end").length;
