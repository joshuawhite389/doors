// Which app Navigate and Directions open on the web (PARITY S14, the phone's Settings → Navigation app): Apple Maps,
// Google Maps or Waze, chosen in ⚙ Settings or under Navigate in Start my day, remembered on this device (a
// convenience: storage may be blocked). Nothing chosen: by the browser (Apple Maps on Apple devices, else Google Maps).
// The links themselves are lib/note.js directionsUrl and lib/drive-day.js navigateUrl.
import { NAV_APPS, navAppName } from "../lib/note.js";

const KEY = "doors:nav-app";
export const savedNavApp = () => { try { const k = localStorage.getItem(KEY); return NAV_APPS.some((a) => a.key === k) ? k : null; } catch { return null; } };
export function setNavApp(k) {
  try { localStorage.setItem(KEY, k); } catch {}
  window.dispatchEvent(new CustomEvent("doors:nav-app", { detail: { app: k } }));
}
export const currentNavName = () => navAppName(savedNavApp(), navigator.userAgent);
// the three choices as buttons, the current one pressed: data-nav-app="<key>"
export const navAppButtons = (cls = "btn line sm") => {
  const cur = NAV_APPS.find((a) => a.name === currentNavName())?.key;
  return NAV_APPS.map((a) => `<button type="button" class="${cls}" data-nav-app="${a.key}" aria-pressed="${a.key === cur}">${a.name}${a.key === cur ? " ✓" : ""}</button>`).join("");
};
