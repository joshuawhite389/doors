// Which app Navigate and Directions open (owner 10-23, his iPhone 17: "I want to be able to choose which navigation app
// I use"). Apple Maps, Google Maps or Waze, whichever are on the phone; the choice is remembered (doors.app.navApp).
// The first Navigate with more than one installed and nothing chosen asks once. Google Maps and Waze are found with
// canOpenURL, which needs their schemes in Info.plist's LSApplicationQueriesSchemes (app.json).
import { Linking } from "react-native";
import { appGet, appSet } from "./storage";
import { menu } from "./ui";

export type NavApp = "apple" | "google" | "waze";
export const NAV_APPS: { key: NavApp; name: string; probe?: string }[] = [
  { key: "apple", name: "Apple Maps" },
  { key: "google", name: "Google Maps", probe: "comgooglemaps://" },
  { key: "waze", name: "Waze", probe: "waze://" },
];
const KEY = "navApp";
export const savedNavApp = (): NavApp | null => (["apple", "google", "waze"].includes(appGet(KEY)) ? appGet(KEY) : null);
export const navAppName = (k: NavApp | null = savedNavApp()) => NAV_APPS.find((a) => a.key === (k ?? "apple"))!.name;

export async function installedNavApps() {
  const out: typeof NAV_APPS = [];
  for (const a of NAV_APPS) {
    if (!a.probe) out.push(a);
    else if (await Linking.canOpenURL(a.probe).catch(() => false)) out.push(a);
  }
  return out;
}

type Pt = { lat: any; lon: any; name?: string };
const ll = (p: Pt) => `${(+p.lat).toFixed(6)},${(+p.lon).toFixed(6)}`;
// driving directions to `to`, from `from` when given (Waze always starts from where the phone is)
export function directionsIn(app: NavApp, to: Pt, from: Pt | null = null) {
  if (app === "google") return `comgooglemaps://?${from ? `saddr=${ll(from)}&` : ""}daddr=${ll(to)}&directionsmode=driving`;
  if (app === "waze") return `waze://?ll=${ll(to)}&navigate=yes`;
  return `https://maps.apple.com/?${from ? `saddr=${ll(from)}&` : ""}daddr=${ll(to)}${to.name ? `&q=${encodeURIComponent(to.name)}` : ""}&dirflg=d`;
}

// the chooser: the installed apps, the current one ticked; calls back with the choice
export async function chooseNavApp(then?: (k: NavApp) => void) {
  const apps = await installedNavApps();
  const cur = savedNavApp() ?? "apple";
  menu("Navigate with", apps.map((a) => ({ label: `${a.name}${a.key === cur ? " ✓" : ""}`, on: () => { appSet(KEY, a.key); then?.(a.key); } })));
}

// open directions in the chosen app; nothing chosen and more than one installed: ask first. An app that has since been
// deleted falls back to Apple Maps.
export async function openDirections(to: Pt, from: Pt | null = null) {
  let app = savedNavApp();
  if (!app) {
    const apps = await installedNavApps();
    if (apps.length > 1) return chooseNavApp((k) => openIn(k, to, from));
    app = "apple";
  }
  return openIn(app, to, from);
}
async function openIn(app: NavApp, to: Pt, from: Pt | null) {
  const url = directionsIn(app, to, from);
  const ok = app === "apple" || (await Linking.canOpenURL(url).catch(() => false));
  return Linking.openURL(ok ? url : directionsIn("apple", to, from));
}
