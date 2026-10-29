// Dev only (live check B): every crowd text Doors holds (public/data/routes) and every live run kept by the dev servers
// (../doors-wt-*/data/kv-dev, read only) through crowdPhrase; prints the openers, or with OLD=<path to an old talk.js
// module> only the ones that changed. Flags an opener ending on a bare adjective ("…and young").
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { crowdPhrase } from "../../public/lib/talk.js";

const root = new URL("../..", import.meta.url).pathname;
const texts = new Map(); // crowd text → where
const add = (route, where) => { for (const v of Object.values(route?.venues ?? {})) if (v?.crowd && !texts.has(v.crowd)) texts.set(v.crowd, `${where}: ${v.name}`); };
for (const f of readdirSync(join(root, "public/data/routes"))) if (f.endsWith(".json")) add(JSON.parse(readFileSync(join(root, "public/data/routes", f), "utf8")), f);
const qloo = join(root, "..");
for (const wt of readdirSync(qloo).filter((d) => d.startsWith("doors"))) {
  const dir = join(qloo, wt, "data/kv-dev");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try { const j = JSON.parse(readFileSync(join(dir, f), "utf8")); add(j.route ?? j, `${wt}/kv-dev`); } catch {}
  }
}
const old = process.env.OLD ? (await import(process.env.OLD)).crowdPhrase : null;
const ADJ_END = /\band (young|old|vibrant|trendy|hip|diverse|upscale|casual|local|lively|stylish|affluent|eclectic|sophisticated|energetic|fashionable|modern|creative|artsy|laid-back|friendly|social|urban|professional|mature|youthful|loyal)$/i;
let n = 0, changed = 0, flagged = 0, said = 0;
for (const [t, where] of texts) {
  n++;
  const p = crowdPhrase({ crowd: t })?.text ?? null;
  if (p) said++;
  const bad = p && ADJ_END.test(p);
  if (bad) flagged++;
  if (old) {
    const o = old({ crowd: t })?.text ?? null;
    if (o === p) continue;
    changed++;
    console.log(`- ${where}\n  crowd: ${t.slice(0, 200)}\n  was:   ${o}\n  now:   ${p}`);
  } else if (bad || process.env.ALL) console.log(`${bad ? "BAD " : ""}${where}: ${p}`);
}
console.log(`${n} crowd texts (${said} make an opener); ${old ? `${changed} changed; ` : ""}${flagged} end on a bare adjective`);
