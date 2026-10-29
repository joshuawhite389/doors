// Which Doors Worker the app talks to. Set EXPO_PUBLIC_DOORS_API when starting Metro, e.g.
//   EXPO_PUBLIC_DOORS_API=http://100.x.y.z:8850 npx expo start
// (a dev Worker the phone can reach: scripts/dev.mjs with HOST=0.0.0.0). Never the production site from a dev build.
export const DOORS_API = (process.env.EXPO_PUBLIC_DOORS_API ?? "http://127.0.0.1:8850").replace(/\/+$/, "");
