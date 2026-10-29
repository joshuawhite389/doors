// Ask Doors over the whole plan (ui/agent.js): the agent reads the plan as the phone holds it and the selected day,
// answers with sources, and changes the plan through the engine (status, outcome, slots, talking points, re-plans)
// with one Undo; "open" goes to that stop; "I'm running late" opens Start my day that late.
import { useNav } from "../nav";
import { chatFor } from "../agent";
import { usePlanEngine } from "./Plan";
import ChatView from "../components/ChatView";
import { Screen, T, Toast } from "../ui";

export default function Ask({ params }: { params: any }) {
  const nav = useNav();
  const e = usePlanEngine(params);
  if (!e?.plan) return <Screen title="Doors Agent"><T k="muted">That plan isn't open.</T></Screen>;
  const chat = chatFor(e);
  return (
    <Screen title="Doors Agent" scroll={false} testID="ask">
      <ChatView chat={chat} prefill={params.prefill} context={() => ({ current: params.current ?? e.focusId ?? null, mode: params.current ? "stop" : "plan" })} /* from a stop: its length (spec §6) */
        onOpen={(id) => nav.push("stop", { ...params, id, day: e.plan.days.findIndex((d: any) => d.stops.some((x: any) => x.id === id)) })}
        onLate={(by) => nav.push("drive", { ...(e.demo ? { demo: true } : { key: e.key }), late: by })} /* ease audit 2 #3: Start my day, that late */ />
      <Toast toast={e.toast} onUndo={() => { const u = e.toast?.undo; e.clearToast(); u?.(); }} onClose={() => e.clearToast()} top />
    </Screen>
  );
}
