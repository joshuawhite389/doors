// The app's screens as a stack (no router dependency): push / back / forward / replace / reset, a hardware back on
// Android, the iOS edge swipe (components/SwipeNav). Each route is {name, params}; App.tsx maps names to screens.
// Jard 10-23 #4: the landing (home) and the brand form are outside the app, like a sign-up page: the plan is the app's
// root, so opening a plan drops whatever led to it and the plan has no Back (the menu's Home goes back out).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BackHandler } from "react-native";

export type Nav = { has: (name: string) => boolean; stack: Route[]; ahead: Route[]; push: (name: string, params?: any) => void; back: () => void; forward: () => void; goBack: () => void; replace: (name: string, params?: any) => void; reset: (routes: { name: string; params?: any }[]) => void };
export type Route = { name: string; params?: any; key: number };
const Ctx = createContext<Nav | null>(null);
// the current navigator for code outside the screens (the guided tour)
export const navRef: { current: Nav | null } = { current: null };
let seq = 0;

// the app's root screens: a stack never keeps anything under them
export const APP_ROOTS = ["plan", "demo"];
const rooted = (s: Route[]) => {
  let i = -1;
  s.forEach((r, k) => { if (APP_ROOTS.includes(r.name)) i = k; });
  return i > 0 ? s.slice(i) : s;
};

// a touch that began on a sideways row (day tabs, chips: ui.tsx HScroll) is that row's: no forward swipe from the right
// edge over it (mobile2 10-23: the tabs run off that edge)
export const swipeGuard = { hscroll: false };

// a screen's own Back (drive mode pauses the day; a map peek closes the map): the header's Back, the edge swipe and
// Android's back all run it instead of a plain pop. Keyed by the route, so a screen under the top never answers.
const backOverrides = new Map<number, () => void>();
export const RouteKey = createContext<number>(0);
export function useBackOverride(fn: (() => void) | null | undefined) {
  const key = useContext(RouteKey);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!key || !fn) return;
    backOverrides.set(key, () => ref.current?.());
    return () => { backOverrides.delete(key); };
  }, [key, !!fn]);
}

export function NavProvider({ initial, names, children }: { initial: { name: string; params?: any }[]; names: string[]; children: (top: Route, nav: Nav) => React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>(() => rooted(initial.map((r) => ({ ...r, key: ++seq }))));
  // what Back popped, newest last: a swipe from the right edge brings it back (Jard 10-23 #1: "swipe back and forward")
  const [ahead, setAhead] = useState<Route[]>([]);
  const push = useCallback((name: string, params?: any) => { setAhead([]); setStack((s) => rooted([...s, { name, params, key: ++seq }])); }, []);
  // pop and re-push from the rendered stack, not inside a state updater (an updater runs twice in dev)
  const live = useRef({ stack, ahead });
  live.current = { stack, ahead };
  const back = useCallback(() => {
    const s = live.current.stack;
    if (s.length < 2) return;
    setAhead([...live.current.ahead, s[s.length - 1]]);
    setStack(s.slice(0, -1));
  }, []);
  const forward = useCallback(() => {
    const a = live.current.ahead;
    if (!a.length) return;
    setAhead(a.slice(0, -1));
    setStack([...live.current.stack, { ...a[a.length - 1], key: ++seq }]);
  }, []);
  const replace = useCallback((name: string, params?: any) => { setAhead([]); setStack((s) => rooted([...s.slice(0, -1), { name, params, key: ++seq }])); }, []);
  const reset = useCallback((routes: { name: string; params?: any }[]) => { setAhead([]); setStack(rooted(routes.map((r) => ({ ...r, key: ++seq })))); }, []);
  const has = useCallback((n: string) => names.includes(n), [names]);
  const topKey = stack[stack.length - 1]?.key;
  // Back as the user means it: the top screen's own Back if it has one, else a pop
  const goBack = useCallback(() => { const o = topKey != null ? backOverrides.get(topKey) : null; if (o) o(); else back(); }, [topKey, back]);
  const nav = useMemo(() => ({ has, stack, ahead, push, back, forward, goBack, replace, reset }), [has, stack, ahead, push, back, forward, goBack, replace, reset]);
  navRef.current = nav;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (stack.length > 1 ? (goBack(), true) : false));
    return () => sub.remove();
  }, [stack.length, goBack]);
  return <Ctx.Provider value={nav}>{children(stack[stack.length - 1], nav)}</Ctx.Provider>;
}
export const useNav = () => useContext(Ctx)!;

// The Agent button's place on the current screen (Jard 10-23 #6: one Agent button, bottom-right, on every screen, never
// over what matters): a screen with its own footer lifts it above the footer, hides it while a sheet is open, or gives
// it what to ask about. Keyed by the route; App.tsx draws the one button for the top route.
// which plan the Agent button asks about on a route, or null where it never shows (the landing, the Agent itself, a
// screen with no plan behind it): App.tsx draws it from this, ui.tsx's scroll views keep room for it from this
const NO_AGENT = ["home", "ask"];
export function agentTo(r: Route | undefined): { demo: true } | { key: any } | null {
  if (!r || NO_AGENT.includes(r.name)) return null;
  const p = r.params ?? {};
  return r.name === "demo" || p.demo ? { demo: true } : p.key ? { key: p.key } : p.edit ? { key: { brand: p.edit.brand, city: p.edit.city } } : null;
}
export type AgentSpot = { bottom?: number; hide?: boolean; onPress?: () => void; current?: string | null };
const spots = new Map<number, AgentSpot>();
const subs = new Set<() => void>();
let ver = 0;
const ping = () => { ver++; subs.forEach((f) => f()); };
export function useAgentSpot(spot: AgentSpot) {
  const key = useContext(RouteKey);
  const ref = useRef(spot);
  ref.current = spot;
  const sig = `${spot.bottom ?? ""}|${!!spot.hide}|${spot.current ?? ""}|${!!spot.onPress}`;
  useEffect(() => {
    if (!key) return;
    spots.set(key, { ...spot, onPress: spot.onPress ? () => ref.current.onPress?.() : undefined });
    ping();
  }, [key, sig]);
  useEffect(() => () => { spots.delete(key); ping(); }, [key]);
}
export function useAgentSpotFor(key: number | undefined): AgentSpot {
  useSyncExternalStore((f) => (subs.add(f), () => { subs.delete(f); }), () => ver);
  return (key != null && spots.get(key)) || {};
}
