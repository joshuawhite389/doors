// The Export drawer (SPEC-V2 §3.4): the plan as CSV (B1), every drafted note as text, and a printable call sheet
// (one block per stop with its talking points). Notes and the sheet are built with lib/stopmodel.js, the same content
// the stop panel shows.
import { notesText, callSheetHTML } from "../lib/export.js";
import { loadStopData, modelFor } from "./stop.js";

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export function download(text, name, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

// The stops worth a note or a sheet: every day still ahead (not past), in day order.
async function models(plan) {
  const data = await loadStopData(plan);
  const out = [];
  plan.days.forEach((d, i) => {
    if (!d || d.past) return;
    for (const s of d.stops) out.push(modelFor(plan, s.id, i, data));
  });
  return { stops: out, data };
}

// drawExport(box, {plan, brand, onCSV, flash})
export function drawExport(box, { plan, brand, onCSV, flash }) {
  const n = plan.days.filter((d) => d && !d.past).reduce((a, d) => a + d.stops.length, 0);
  box.innerHTML = `<h3>Export</h3>
    <ul class="xlist">
      <li><div><b>Plan as CSV: for your CRM or your manager</b><div class="small muted">Every stop with times, status, outcome and follow-up date.</div></div><button class="btn line sm" data-x="csv">Download</button></li>
      <li><div><b>Drafted messages</b><div class="small muted">${n} message${n === 1 ? "" : "s"} as plain text, one per stop. Edit before sending.</div></div><button class="btn line sm" data-x="notes" ${n ? "" : "disabled"}>Download</button></li>
      <li><div><b>Call sheet</b><div class="small muted">A printable page per stop: facts, opener, questions to tick, points with sources, the ask.</div></div><button class="btn line sm" data-x="print" ${n ? "" : "disabled"}>Print</button></li>
    </ul>
    <p class="small muted">Saved on this device only.</p>`;
  box.onclick = async (e) => {
    const x = e.target.closest("[data-x]")?.dataset.x;
    if (!x) return;
    if (x === "csv") return onCSV();
    const { stops, data } = await models(plan);
    const name = `doors-${slug(brand)}-${plan.city.key}`;
    if (x === "notes") {
      download(notesText(stops, { brand, city: plan.city.name }), `${name}-notes.txt`, "text/plain");
      flash?.(`${stops.length} drafted messages downloaded as text.`);
    } else {
      document.querySelector(".callsheet-print")?.remove();
      const el = document.createElement("div");
      el.className = "callsheet-print";
      el.innerHTML = callSheetHTML(stops, { brand, city: plan.city.name, label: plan.pool.label, captured: data.captured ?? "" });
      document.body.append(el);
      addEventListener("afterprint", () => el.remove(), { once: true }); // a later Ctrl+P prints the page, not this sheet
      await document.fonts?.ready; // the sheet's fonts are in before print lays it out
      window.print();
    }
  };
}
