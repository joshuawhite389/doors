// Doors' service worker (R9 drive mode): an offline shell. Network first for everything, so a new deploy is never
// hidden behind a stale copy; the cache answers only when the network can't (a dead zone between doors). The API
// (/api/*) and map tiles are never cached: a live run or a log-visit offline falls back in the page itself
// (lib/drive-log.js runs the rules parser). The page sends the files it loaded (`warm`), so the shell that worked
// online is the one kept for offline.
const CACHE = "doors-shell-v2"; // v2: self-hosted fonts (judge pass 4, 19), so an old worker's copies go
const CORE = ["/app", "/manifest.json", "/favicon.svg", "/icons/icon.svg", "/icons/icon-192.png", "/css/doors.css", "/css/drive.css", "/data/index.json"];
const KEEP = []; // libraries and fonts are same-origin now (public/vendor/); nothing from another origin is kept

const cacheable = (url) => {
  const u = new URL(url);
  if (u.origin === self.location.origin) return !/^\/(api|tiles)\//.test(u.pathname) && u.pathname !== "/sw.js";
  return KEEP.some((r) => r.test(url));
};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => {
  if (e.data?.type !== "warm" || !Array.isArray(e.data.urls)) return;
  const urls = e.data.urls.filter((u) => typeof u === "string" && cacheable(u)).slice(0, 200);
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || c.add(new Request(u, { mode: new URL(u).origin === self.location.origin ? "same-origin" : "no-cors" })).catch(() => {}))))));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !cacheable(req.url)) return;
  const nav = req.mode === "navigate";
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(nav ? new URL(req.url).pathname : req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const c = await caches.open(CACHE);
        return (await c.match(req, { ignoreSearch: nav })) ?? (nav ? await c.match("/app") : null) ?? Response.error();
      }),
  );
});
