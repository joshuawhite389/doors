// Your rules (R9 S6, docs/CULTURAL-SLOTS.md) in Edit profile: the brand's own words, every city: "never say …" hides a
// line on every stop; "say … instead of …" rewrites it. They are brand-wide, so they live with the profile, not on each
// door card (ease audit #9). The phone's twin is app-mobile/src/screens/Form.tsx (RulesBox).
// mountRules(host, {brand, get() → records, set(records)}) → cleanup. Inside the profile <form>: no nested forms, and
// Enter in a rule box adds the rule instead of building the plan.
import { makeRecord, supersededRules, ruleInName } from "../lib/slots.js";
import { $, esc } from "./dom.js";

export const ruleText = (r) => (r.field === "rule.avoid" ? `Never say “${r.value}”` : `Say “${r.value.to}”, not “${r.value.from}”`);

export function mountRules(host, { brand = "", get, set }) {
  if (!host) return () => {};
  const draw = () => {
    const rs = get().filter((r) => /^rule\./.test(r.field));
    // judge pass 4 (#1): two rules on one word, the newest wins; a rule word in the brand's name leaves the name alone
    const old = supersededRules({ "*": rs }, "*");
    const tag = (r) => (old.includes(r) ? ` <small class="muted">· replaced by a newer rule</small>` : ruleInName(r.field === "rule.term" ? r.value?.from : r.value, [brand]) ? ` <small class="muted">· not in your brand name</small>` : "");
    host.innerHTML = `<details class="opt rules" id="fd-rules"${rs.length || host.dataset.open ? " open" : ""}>
      <summary><b>Your rules</b> <span class="muted">optional · words Doors never uses${rs.length ? ` · ${rs.length}` : ""}</span></summary>
      <p class="hint">Words Doors must never use, or must say your way, in every drafted message and talking point for ${esc(brand || "your brand")}, in every city.</p>
      ${rs.length ? `<ul class="rlist">${rs.map((r, i) => `<li><span>${esc(ruleText(r))}${tag(r)}</span><button type="button" class="lnk" data-rule-del="${i}" aria-label="Remove rule: ${esc(ruleText(r))}">Remove</button></li>`).join("")}</ul>` : ""}
      <div class="rform" data-f="avoid"><label for="r-avoid">Never say</label><input class="inp" id="r-avoid" maxlength="60" placeholder="e.g. mocktail"><button type="button" class="btn sm line" data-rule-add="avoid">Add</button></div>
      <div class="rform" data-f="term"><label for="r-to">Say</label><input class="inp" id="r-to" maxlength="40" placeholder="alcohol-free"><label for="r-from">instead of</label><input class="inp" id="r-from" maxlength="40" placeholder="non-alcoholic"><button type="button" class="btn sm line" data-rule-add="term">Add</button></div>
    </details>`;
  };
  const add = (kind) => {
    const v = (sel) => $(sel, host)?.value.trim() ?? "";
    const rec = kind === "avoid"
      ? v("#r-avoid") && { field: "rule.avoid", value: v("#r-avoid") }
      : v("#r-to") && v("#r-from") && { field: "rule.term", value: { from: v("#r-from"), to: v("#r-to") } };
    if (!rec) return $(kind === "avoid" ? "#r-avoid" : v("#r-to") ? "#r-from" : "#r-to", host)?.focus();
    set([...get(), makeRecord({ slot: "S6", ...rec, source: "corrected", by: "rep" })]);
    host.dataset.open = "1";
    draw();
    $(kind === "avoid" ? "#r-avoid" : "#r-to", host)?.focus();
  };
  const onClick = (e) => {
    const a = e.target.closest("[data-rule-add]");
    if (a) return add(a.dataset.ruleAdd);
    const d = e.target.closest("[data-rule-del]");
    if (!d) return;
    const rs = get().filter((r) => /^rule\./.test(r.field));
    const r = rs[Number(d.dataset.ruleDel)];
    if (!r) return;
    set(get().filter((x) => x !== r && !(x.field === r.field && JSON.stringify(x.value) === JSON.stringify(r.value))));
    host.dataset.open = "1";
    draw();
    $("#r-avoid", host)?.focus();
  };
  const onKey = (e) => {
    const f = e.target.closest?.(".rform");
    if (e.key !== "Enter" || !f) return;
    e.preventDefault(); // not the profile form's submit (Build my plan)
    add(f.dataset.f);
  };
  draw();
  host.addEventListener("click", onClick);
  host.addEventListener("keydown", onKey);
  return () => {
    host.removeEventListener("click", onClick);
    host.removeEventListener("keydown", onKey);
  };
}
