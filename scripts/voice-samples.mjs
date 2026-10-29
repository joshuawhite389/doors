// Dev only: the same drive-mode answer in a few Aura-2 voices, so Jard picks TTS_VOICE (src/voice.js) by ear.
// Usage: node scripts/voice-samples.mjs <outdir> <voice> [<voice> …]   → <outdir>/voice-<A|B|…>-<voice>.mp3
// Workers AI over REST (scripts/dev/workers-ai-rest.mjs, the account token never printed); ~2.7 free neurons a character.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workersAiRest } from "./dev/workers-ai-rest.mjs";
import { ttsPlan, AURA_VOICES, sayable } from "../src/voice.js";

// a drive-mode answer as the spec has it: 1–2 sentences that read well aloud, the trade's words
export const SAMPLE = "Next up is Pacific Standard, eight minutes out. Ask for the bar manager and lead with the dry-hopped N/A: they just put two seltzers on the menu, so a third won't land.";

const [outdir, ...voices] = process.argv.slice(2);
if (!outdir || !voices.length || voices.some((v) => !AURA_VOICES.includes(v))) {
  console.error(`usage: node scripts/voice-samples.mjs <outdir> <voice>…   voices: ${AURA_VOICES.join(" ")}`);
  process.exit(2);
}
mkdirSync(outdir, { recursive: true });
const ai = workersAiRest();
const text = sayable(SAMPLE);
for (const [i, v] of voices.entries()) {
  const plan = ttsPlan({ TTS_VOICE: v }, text);
  const t0 = Date.now();
  const mp3 = await ai.run(plan.model, plan.input);
  const file = join(outdir, `voice-${String.fromCharCode(65 + i)}-${v}.mp3`);
  writeFileSync(file, mp3);
  console.log(`${file}  ${mp3.byteLength} bytes  ${Date.now() - t0} ms  ~${Math.round(plan.neurons)} neurons (${text.length} chars)`);
}
