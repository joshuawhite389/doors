// Export (public/ui/export.js): the plan as a .csv file, every drafted note as text, and the call sheet — each through
// the iOS share sheet (Save to Files, Mail, Copy, Print from the sheet), as the web downloads or prints them. The CSV
// is written to the cache directory and shared by its file URL (RN Share's iOS `url`), so it lands as a real file. Same content as
// the web: lib/export.js's planCSV, notesText and callSheetText (callSheetHTML's content as text: the phone has no print
// view without a native module) over lib/stopmodel.js.
import { useEffect, useState } from "react";
import { Platform, Share, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { planCSV, notesText, callSheetText } from "../../../public/lib/export.js";
import { stopModel, isMerged } from "../../../public/lib/stopmodel.js";
import { usePlanEngine } from "./Plan";
import { useAgentSpot } from "../nav";
import { Btn, C, Screen, T, Toast, s } from "../ui";

const slug = (t: string) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// the text as a file named `name` in the cache directory (replacing last export's), for the share sheet's url
function writeFile(name: string, text: string) {
  const f = new File(Paths.cache, name);
  f.create({ overwrite: true });
  f.write(text);
  return f.uri;
}

export default function Export({ params }: { params: any }) {
  const e = usePlanEngine(params);
  useAgentSpot({ hide: true }); // intuit 1b #6 (mobile2 10-24): nothing to ask here; the 💬 only covered the page
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { e?.stopData().then(setData).catch(() => setData({})); }, [e]);
  const plan = e?.plan;
  if (!e || !plan) return <Screen title="Export"><T k="muted">That plan isn't open.</T></Screen>;
  const brand = e.brand;
  const n = plan.days.filter((d: any) => d && !d.past).reduce((a: number, d: any) => a + d.stops.length, 0);
  const name = `doors-${slug(brand)}-${plan.city.key}`;
  // the stops worth a note or a sheet: every day still ahead (not past), in day order (export.js models)
  const models = () => {
    const out: any[] = [];
    plan.days.forEach((d: any, i: number) => {
      if (!d || d.past) return;
      for (const st of d.stops) out.push(stopModel({ plan, id: st.id, dayIndex: i, ...data }));
    });
    return out;
  };
  const share = async (k: string, title: string, make: () => string, done: string, asFile = false) => {
    setBusy(k);
    try {
      const r = await Share.share(asFile && Platform.OS === "ios" ? { title, url: writeFile(title, make()) } : { title, message: make() });
      if (r.action === Share.sharedAction) e.flash(done);
    } catch (err: any) {
      e.flash(`Couldn't open the share sheet: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  };
  const csv = () => planCSV({ plan, venues: plan.venues, pool: plan.pool, statuses: plan.statuses, outcomes: e.st.outcomes, captured: e.captured, source: plan.source, merged: isMerged(e.profile) });
  const items: { k: string; title: string; text: string; btn: string; off?: boolean; go: () => void }[] = [
    { k: "csv", title: "Plan as CSV: for your CRM or your manager", text: "Every stop with times, status, outcome and follow-up date.", btn: "Share", go: () => share("csv", `${name}.csv`, csv, "Plan exported as CSV: every stop with its status and outcome.", true) },
    { k: "notes", title: "Drafted messages", text: `${n} message${n === 1 ? "" : "s"} as plain text, one per stop. Edit before sending.`, btn: "Share", off: !n || !data, go: () => share("notes", `${name}-notes.txt`, () => notesText(models(), { brand, city: plan.city.name }), `${n} drafted messages shared as text.`) },
    { k: "sheet", title: "Call sheet", text: "A block per stop: facts, opener, questions to tick, points with sources, the ask. Copy it, save it to Files or send it from the share sheet.", btn: "Share", off: !n || !data, go: () => share("sheet", `${name}-call-sheet.txt`, () => callSheetText(models(), { brand, city: plan.city.name, label: plan.pool.label, captured: data?.captured ?? "" }), "Call sheet shared.") },
  ];
  return (
    <Screen title="Export" testID="export" scroll footer={<Toast toast={e.toast} onUndo={() => { e.toast?.undo?.(); e.clearToast(); }} onClose={() => e.clearToast()} />}>
      <T k="h2">Export</T>
      <T k="muted">{brand} · {plan.city.name}</T>
      {items.map((x) => (
        <View key={x.k} style={s.card} testID={`x-${x.k}`}>
          <T k="h3">{x.title}</T>
          <T k="muted" style={{ marginTop: 4 }}>{x.text}</T>
          <Btn kind="line" small label={busy === x.k ? "Opening…" : x.btn} a11y={busy === x.k ? "Opening…" : `${x.btn} ${x.k === "csv" ? "the plan as CSV" : `the ${x.title.toLowerCase()}`}`} disabled={x.off || !!busy} onPress={x.go} style={{ marginTop: 10, alignSelf: "flex-start" }} testID={`x-${x.k}-go`} />
        </View>
      ))}
      <T k="small" style={{ marginTop: 16, color: C.ink3 }}>Saved on this device only. Nothing is sent from Doors: the share sheet is yours.</T>
    </Screen>
  );
}
