// Doors icons (Jard 10-24 #1: "replace ios style icons with door style custom icons"): one set, drawn on a 24-unit grid
// with a 2-unit round stroke. The door itself (an arched top, square foot, a knob) is the motif where Jard kept it (the
// logo door, Why is a door with a question, the lock's shackle, Agent's bubble); Directions and Website are the universal
// shapes, Log visit is a plain check and Sister doors is the ≈ it was, drawn in the set (Jard 10-24, on the sheet). One source of truth: the web inlines
// these as SVG (icon()), and scripts/make-icons.mjs renders the same shapes to app-mobile/assets/icons/*.png (@1x/2x/3x),
// which the phone tints (src/icons.tsx). Icons are decoration: the button or row around one keeps its own words/label.
// A filled shape is marked F (fill, no stroke); everything else is stroked.
const F = 'fill="currentColor" stroke="none"';
const KNOB = (x, y) => `<circle cx="${x}" cy="${y}" r="1.3" ${F}/>`;

export const ICONS = {
  door: { label: "Door", body: `<path d="M6 21V9a6 6 0 0 1 12 0v12z"/>${KNOB(14.5, 13.5)}` },
  directions: { label: "Directions", body: `<path d="M10.6 2.9a2 2 0 0 1 2.8 0l7.7 7.7a2 2 0 0 1 0 2.8l-7.7 7.7a2 2 0 0 1-2.8 0l-7.7-7.7a2 2 0 0 1 0-2.8z"/><path d="M9 15.5v-3a2 2 0 0 1 2-2h5"/><path d="M13.5 8l2.5 2.5-2.5 2.5"/>` },
  call: { label: "Call", body: `<path d="M8.6 3.6 6.2 4.4A2.6 2.6 0 0 0 4.5 7.3c.8 6.3 5.9 11.4 12.2 12.2a2.6 2.6 0 0 0 2.9-1.7l.8-2.4a1.4 1.4 0 0 0-.8-1.7l-2.9-1.2a1.4 1.4 0 0 0-1.6.4l-1.1 1.4a10.4 10.4 0 0 1-4.6-4.6l1.4-1.1a1.4 1.4 0 0 0 .4-1.6L10.3 4.4a1.4 1.4 0 0 0-1.7-.8z"/>` },
  message: { label: "Message", body: `<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M4.5 8c3 2.8 5 4.5 7.5 4.5S16.5 10.8 19.5 8"/>` },
  website: { label: "Website", body: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z"/>` },
  search: { label: "Search the web", body: `<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>` },
  notes: { label: "Notes", body: `<path d="M5 19.5 6 15.5 15.6 5.9a2.1 2.1 0 0 1 3 3L9 18.5z"/><path d="M14 7.5l3 3"/><path d="M13 20h7"/>` },
  visit: { label: "Log visit", body: `<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>` },
  check: { label: "Done", body: `<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>` },
  agent: { label: "Ask Doors", body: `<path d="M4.5 20V11a7.5 7.5 0 0 1 15 0v1a6 6 0 0 1-6 6H8.5z"/><circle cx="8.8" cy="12" r="1.2" ${F}/><circle cx="12" cy="12" r="1.2" ${F}/><circle cx="15.2" cy="12" r="1.2" ${F}/>` },
  why: { label: "Market", body: `<path d="M5 21V9a7 7 0 0 1 14 0v12z"/><path d="M9.8 10a2.3 2.3 0 1 1 3.3 2.1c-.7.4-1.1.9-1.1 1.7v.5"/><circle cx="12" cy="17.6" r="1.2" ${F}/>` },
  drinkers: { label: "Your drinkers", body: `<circle cx="9" cy="7.5" r="3"/><circle cx="17" cy="8.5" r="2.5"/><path d="M3 19.5c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 14c3 0 6 2 6 5.5"/>` }, // round 6 #3 (Jard 10-27: "i like the design we had before"): the two people the Who card had before round 5, its box (3–21 × 4.5–19.5) centred on the grid; round 5's raised glasses are gone
  sisters: { label: "Sister doors", body: `<path d="M4 9.5c2.7-2 5.3-2 8 0s5.3 2 8 0"/><path d="M4 15c2.7-2 5.3-2 8 0s5.3 2 8 0"/>` },
  menu: { label: "Menu", body: `<path d="M4 6.5h16"/><path d="M4 12h16"/><path d="M4 17.5h16"/>` },
  share: { label: "Export", body: `<path d="M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/><path d="M12 14V3"/><path d="M8 6.5 12 3l4 3.5"/>` },
  settings: { label: "Settings", body: `<path d="M4 7h4"/><path d="M12 7h8"/><circle cx="10" cy="7" r="2.2"/><path d="M4 17h9"/><path d="M17 17h3"/><circle cx="15" cy="17" r="2.2"/>` },
  home: { label: "Home", body: `<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-4a2 2 0 0 1 4 0v4"/>` },
  voice: { label: "Voice on", body: `<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.8 6.5a7.5 7.5 0 0 1 0 11"/>` },
  mute: { label: "Voice off", body: `<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15.5 9.5l5 5"/><path d="M20.5 9.5l-5 5"/>` },
  mic: { label: "Talk", body: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>` },
  stop: { label: "Stop", body: `<rect x="6" y="6" width="12" height="12" rx="2.5" ${F}/>` },
  play: { label: "Play", body: `<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" ${F}/>` },
  pause: { label: "Pause", body: `<rect x="6.5" y="5" width="4" height="14" rx="1.5" ${F}/><rect x="13.5" y="5" width="4" height="14" rx="1.5" ${F}/>` },
  lock: { label: "Locked", body: `<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>${KNOB(12, 15.5)}` },
  followup: { label: "Follow up", body: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.5v4h-4"/>` },
  star: { label: "Rating", body: `<path d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z" ${F}/>` },
  close: { label: "Close", body: `<path d="M6 6l12 12"/><path d="M18 6 6 18"/>` },
  more: { label: "More", body: `<circle cx="5.5" cy="12" r="1.7" ${F}/><circle cx="12" cy="12" r="1.7" ${F}/><circle cx="18.5" cy="12" r="1.7" ${F}/>` },
  grip: { label: "Move", body: `<circle cx="9" cy="6" r="1.5" ${F}/><circle cx="15" cy="6" r="1.5" ${F}/><circle cx="9" cy="12" r="1.5" ${F}/><circle cx="15" cy="12" r="1.5" ${F}/><circle cx="9" cy="18" r="1.5" ${F}/><circle cx="15" cy="18" r="1.5" ${F}/>` },
  restart: { label: "Restart", body: `<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v4h4"/>` },
  send: { label: "Send", body: `<path d="M12 19V5.5"/><path d="M6 11.5 12 5.5l6 6"/>` }, // round 7 (Jard 10-27): the Agent's round Send at a phone width
};

// <svg> markup for one icon: decorative (aria-hidden), sized in px, coloured by the text colour around it.
const ALIAS = { start: "home" }; // the map's start pin (was ⌂) is the house
export function icon(name, size = 20, cls = "ic") {
  const i = ICONS[ALIAS[name] ?? name];
  if (!i) return "";
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${i.body}</svg>`;
}
