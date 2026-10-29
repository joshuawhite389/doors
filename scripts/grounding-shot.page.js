// Run in the page by scripts/grounding-shot.mjs (the guided demo's ?instant=1 end state): one door, three cards from the
// real stop model, composed for SUBMISSION.md's lead image. It shows what Qloo decides, not only how a line is worded:
// which door (Qloo's taste rank vs the same doors by popularity), why this door, its part of town, the doors like it,
// then what she says there. Generic = the same door and profile (her brand, her price) with every Qloo input withheld,
// as the proof harness's slots do, her drinker brand too: it is what Doors asks Qloo about, so without Qloo the card
// doesn't know it (judge pass 3 N19, pass 4 #7: "We already have Athletic Brewing" read as knowing her drinker);
// Tuesday = + her drinker brand and Qloo's data on it; Thursday = + the visit the tour logs.
// The Thursday chips use the tour's own words for what changed a line (lib/demo-return.js, card "Thursday, she's back").
(async () => {
  const S = await import("/ui/state.js");
  const { stopModel } = await import("/lib/stopmodel.js");
  const { loadStopData } = await import("/ui/stop.js");
  const { lineSources } = await import("/lib/provenance.js");
  const { returnDiff, GREETING_ONLY } = await import("/lib/demo-return.js");
  const p0 = S.getPlan();
  const id = "00000000-0000-4000-8000-271655E6AA28";
  const di = p0.days.findIndex((d) => d.stops.some((s) => s.id === id) && d.date !== p0.days[0].date);
  const tue = p0.days[0].date;
  // what the tour logs at Nomadic (ui/demo.js DEMO_VISIT), unless the end state already holds her visit
  const plan = p0.outcomes?.[id]?.who ? p0 : { ...p0, outcomes: { ...p0.outcomes, [id]: { result: "interested", followUp: p0.days[di].date, who: "Sam, the bar manager", note: "Liked the samples, hesitant about price", at: new Date(`${tue}T16:00:00`).toISOString() } } };
  const data = await loadStopData(plan);
  const off = { city: { ...data.city, talk: { venues: {} } }, deepOff: true, slotsOff: ["S4", "S6", "S1", "S1t"] };
  const v = { ...plan.venues[id] }; delete v.crowd; delete v.ambience;
  const gplan = { ...plan, profile: { ...plan.profile, drinks: [] }, venues: { ...plan.venues, [id]: v } };
  const back = stopModel({ plan, id, dayIndex: di, ...data }); // Thursday, back
  const backNoMem = stopModel({ plan, id, dayIndex: di, ...data, slotsOff: ["S4"] }); // the tour card's "before"
  const first = stopModel({ plan: p0, id, dayIndex: 0, ...data }); // Tuesday, first visit: Qloo's data on the door
  const generic = stopModel({ plan: { ...gplan, outcomes: p0.outcomes }, id, dayIndex: 0, ...data, ...off });
  const sf = lineSources(first);
  const diff = Object.fromEntries(returnDiff(backNoMem, back).rows.map((r) => [r.key, r]));

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const chip = (c) => (c && c.k !== "tpl" ? ` <span class="srcchip" data-k="${c.k}">${esc(c.label)}</span>` : "");
  const you = (from) => (from ? ` <span class="srcchip" data-k="you">from ${esc(from)}</span>` : "");
  const none = (s) => `<i class="none">${esc(s)}</i>`;
  const same = `<span class="same">same</span>`;
  const words = (s) => String(s).trim().split(/\s+/).length;
  const pb = (x) => (x ? `${x.from === "memory" ? esc(x.objection) : `“${esc(x.objection)}”`} → ${esc(x.reply)}` : "");

  // which door: Qloo's taste rank vs the same 55 doors ordered by Qloo-free popularity
  const ids = plan.pool?.ids ?? [];
  const byPop = [...ids].sort((a, b) => (plan.venues[b]?.popularity ?? 0) - (plan.venues[a]?.popularity ?? 0));
  const popRank = byPop.indexOf(id) + 1;
  const sis = first.sisters ?? [];
  const sisOn = sis.filter((s) => s.on);
  const dayName = (i) => new Date(`${plan.days[i].date}T12:00`).toLocaleDateString("en-US", { weekday: "long" });
  const nBack = plan.days[di].stops.findIndex((s) => s.id === id) + 1;
  const whyText = (m) => m.why.map((l) => `<b class="k">${esc(l.label)}:</b> ${esc(l.text)}`).join("<br>");
  // judge pass 12 #1: the note's first line that says something (a first message opens with a bare "Hi,"); the extra
  // line is the angle's mail line, so it carries the angle's own chip (door tags, door profile), never a hard-coded one
  const note = (m, extra, tag) => {
    const paras = m.note.body.split(/\n+/).map((x) => x.trim()).filter((x) => x && !GREETING_ONLY.test(x));
    const xc = extra && extra === m.talk.angle?.mail ? lineSources(m).toBuyer : null;
    return esc(paras[0]) + tag + (extra ? `<br><span class="xline">${esc(extra)}</span>${chip(xc)}` : "") + `<br><span class="wc">${words(m.note.body)} words in all</span>`;
  };
  const gParas = new Set(generic.note.body.split(/\n+/));
  const qExtra = first.note.body.split(/\n+/).filter(Boolean).find((x) => !gParas.has(x));

  const plans = [
    ["Which door", none(`No taste rank. By popularity alone, this door is #${popRank} of ${ids.length}.`),
      `${esc(first.rankLine)}.${chip({ k: "qloo", label: "from Qloo · rank" })}`,
      `Same door, back on ${esc(dayName(di))} (stop ${nBack}): she said to come back.${you("the visit")}`],
    ["Why this door", none("Nothing to say about its crowd."), whyText(first) + chip({ k: "qloo", label: "from Qloo · door profile" }), same],
    ["Part of town", none("A pin on a map."), esc((first.hood?.text ?? "").replace(/^Part of town: /, "")) + chip(first.hood ? { k: "qloo", label: "from Qloo · heatmap" } : null), same],
    ["Doors like it", none("None."), `Qloo matches its crowd to ${sis.length} more Austin doors; ${sisOn.length} are on her week (${esc(sisOn.slice(0, 3).map((s) => s.name).join(", "))}…).${chip({ k: "qloo", label: "from Qloo · sister doors" })}`, same],
  ].filter((r) => !/^\s*$/.test(r[2].replace(/<[^>]+>/g, "")));
  const said = (r, g, q) => (r && r.changed ? esc(r.after) + you(r.from) : r && !r.changed ? same : q);
  // judge pass 3 (N19): a Tuesday line Qloo doesn't change says so, not the left card's words again
  const asLeft = `<span class="same">same as without Qloo</span>`;
  const qOr = (g, q) => (g === q ? asLeft : q);
  const talk = [
    ["Who to ask for", esc(generic.talk.before[0]), qOr(esc(generic.talk.before[0]), esc(first.talk.before[0])), said(diff.contact)],
    ["Opener", esc(generic.talk.opener), generic.talk.opener === first.talk.opener ? asLeft : esc(first.talk.opener) + chip(sf.opener), said(diff.opener)],
    // judge pass 12 #1: the line for the buyer is where Qloo's data now shapes what she says (the opener is who she is + who buys)
    ["To the buyer", generic.talk.toBuyer ? esc(generic.talk.toBuyer) : none("None."), generic.talk.toBuyer === first.talk.toBuyer ? asLeft : esc(first.talk.toBuyer ?? "") + chip(sf.toBuyer),
      back.talk.toBuyer ? (back.talk.toBuyer === first.talk.toBuyer ? same : esc(back.talk.toBuyer)) : none("None on a return visit: she asks for the order.")],
    ["First pushback", pb(generic.talk.pushback[0]), pb(generic.talk.pushback[0]) === pb(first.talk.pushback[0]) ? asLeft : pb(first.talk.pushback[0]) + chip(sf.pushback[0]), said(diff.pushback)],
    ["Her note", note(generic, null, ""), note(first, qExtra, ""), note(back, null, you(diff.note?.from))],
  ];
  const bandRow = (t) => `<div class="band">${t}</div>`;
  const row = ([l, a, b, c]) => `<div class="lb">${l}</div><div class="a">${a}</div><div class="b">${b}</div><div class="c">${c}</div>`;
  document.body.innerHTML = `<main class="ba">
    <h1>One door, three cards: <span>${esc(first.venue.name)}, Austin</span></h1>
    <p class="sub">Tidewell (a made-up non-alcoholic hazy IPA): her brand and her price on all three cards. All three are Doors' own code. The left one has Qloo withheld: no taste rank, door profile, door tags or maps, and not her drinker brand (Athletic Brewing), which is what Doors asks Qloo about.</p>
    <div class="grid"><div class="hd"></div><div class="hd g">Without Qloo's taste data<small>Doors with Qloo's taste rank and door data withheld</small></div><div class="hd d">Tuesday, first visit<small>+ her drinker brand, Qloo's taste data and door profile</small></div><div class="hd d2">${esc(dayName(di))}, back<small>+ what she logged on her visit</small></div>
    ${bandRow("Where she goes, and why: Qloo decides")}
    ${plans.map(row).join("")}
    ${bandRow("What she says at the door")}
    ${talk.map(row).join("")}</div>
    <p class="foot">Chips show each line's source: <span class="srcchip" data-k="qloo">Qloo</span> = Qloo's data for this door · <span class="srcchip" data-k="you">you</span> = what the rep logged. Unmarked = Doors' template. “same” = unchanged from Tuesday; “same as without Qloo” = Qloo doesn't change it.</p></main>`;
  const st = document.createElement("style");
  st.textContent = `html,body{background:#F7F6F2;margin:0}.ba{width:1400px;box-sizing:border-box;padding:30px 40px 26px;font:15px/1.42 Inter,system-ui,sans-serif;color:#17191B}
  .ba h1{font:700 26px "Inter Tight",Inter,sans-serif;letter-spacing:-.02em;margin:0 0 4px}.ba h1 span{color:#2F5D4E}
  .ba .sub{color:#4A4F55;margin:0 0 16px;font-size:14px}.grid{display:grid;grid-template-columns:128px 1fr 1.25fr 1fr;gap:0;background:#fff;border-radius:16px;box-shadow:0 1px 2px rgba(20,20,20,.04),0 8px 24px rgba(20,20,20,.06);overflow:hidden}
  .grid>div{padding:9px 16px;border-top:1px solid #EFEDE7}.grid .hd{border-top:0;font-weight:700;font-size:15px;padding-top:14px;padding-bottom:12px}.grid .hd small{display:block;font-weight:500;font-size:12.5px;color:#868B91}
  .grid .band{grid-column:1/-1;font:700 11.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#4A4F55;background:#FAF9F6;padding:7px 16px}
  .hd.g{color:#868B91}.hd.d{color:#2F5D4E;background:#F2F7F4}.lb{font-weight:600;font-size:13px;color:#4A4F55}.a{color:#868B91;font-size:14px}.b{background:#F2F7F4;font-size:14px}.c{background:#FDF4EC;font-size:14px}.hd.d2{color:#8a420c;background:#FDF4EC}
  .none{color:#9A9EA3}.same{color:#B0A090;font-style:italic}.k{font-weight:600}
  .wc{font-size:12px;color:#868B91;white-space:nowrap}.xline{display:inline-block;margin-top:6px}.foot{font-size:12.5px;color:#868B91;margin:12px 2px 0}`;
  document.head.append(st);
  window.scrollTo(0, 0);
  return { rows: plans.length + talk.length, popRank, N: ids.length, sisters: sis.length, sisOn: sisOn.length, backDay: dayName(di), nBack, h: document.querySelector(".ba").offsetHeight };
})()
