// Hash router for /app: #/new (the first profile), #/demo, #/plan, #/edit, and (group 3 #5) #/brand (Edit my brand),
// #/cities (My cities), #/city (add a city; ?city=… edits that one). A saved plan is #/plan?brand=…&city=…; #/edit
// takes the same params (or demo=1) and loads that profile into the form. Pure: the browser glue takes a window-like object so tests
// can drive it with a fake.
export const ROUTES = ["new", "demo", "plan", "edit", "brand", "cities", "city"];
export const DEFAULT_ROUTE = "new";

// "#/plan?day=2026-10-13" → {name:"plan", params:{day:"2026-10-13"}, known:true}. Unknown or empty → the default.
export function parseHash(hash) {
  const m = /^#\/([a-z-]+)\/?(?:\?(.*))?$/.exec(String(hash ?? "").trim());
  const known = !!m && ROUTES.includes(m[1]);
  const params = known ? Object.fromEntries(new URLSearchParams(m[2] ?? "")) : {};
  return { name: known ? m[1] : DEFAULT_ROUTE, params, known };
}

export function hrefFor(name, params = {}) {
  if (!ROUTES.includes(name)) throw new Error(`unknown route ${name}`);
  const q = new URLSearchParams(params).toString();
  return `#/${name}${q ? "?" + q : ""}`;
}

// guard(route) may return another route name to redirect to (e.g. #/plan with no profile → "new").
// Returns {go(name, params), current(), stop()}; calls onRoute(route) once now and on every hash change.
export function createRouter(win, { onRoute, guard = () => null }) {
  let current = null;
  const resolve = () => {
    let route = parseHash(win.location.hash);
    const to = guard(route);
    if (to && to !== route.name) route = { name: to, params: {}, known: true, redirectedFrom: route.name };
    const want = hrefFor(route.name, route.params);
    if (win.location.hash !== want) {
      // replace, not push: a redirect should not leave a dead entry in history
      if (win.history?.replaceState) win.history.replaceState(null, "", want);
      else win.location.hash = want;
    }
    current = route;
    onRoute(route);
  };
  const onHash = () => resolve();
  win.addEventListener("hashchange", onHash);
  resolve();
  return {
    go(name, params) {
      const h = hrefFor(name, params);
      if (win.location.hash === h) resolve();
      else win.location.hash = h;
    },
    current: () => current,
    stop: () => win.removeEventListener("hashchange", onHash),
  };
}
