import { useEffect, useReducer } from "react";
import type { PlanEngine } from "./engine";
// re-render on every engine change (a re-plan, a toast, a slot)
export function useEngine(e: PlanEngine | null) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => (e ? e.subscribe(bump) : undefined), [e]);
  return e;
}
// a number that moves on every engine change: a memo key for rows that only change with the engine (Plan's Cell)
export function useEngineVer(e: PlanEngine | null) {
  const [n, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => (e ? e.subscribe(bump) : undefined), [e]);
  return n;
}
