// Which model keys the dev server gets (a SAMPLE=1 server reached Gemini from drive mode).
// SAMPLE=1 (offline fixtures) and NO_MODEL=1 never reach a model from any path: no Gemini key, from the env or the key
// file. Workers AI only on an explicit WORKERS_AI=1, and never under SAMPLE. Pure: keyFile is passed in.
export function modelEnv(env = {}, keyFile = () => undefined) {
  const offline = Boolean(env.SAMPLE || env.NO_MODEL);
  return {
    gemini: offline ? undefined : env.GEMINI_API_KEY ?? keyFile("gemini-key"),
    // Doors Agent (Anthropic, paid; Jard's $70/month cap): the same offline rule. NO_ANTHROPIC=1 = the free chain alone
    anthropic: offline || env.NO_ANTHROPIC ? undefined : env.ANTHROPIC_API_KEY ?? keyFile("anthropic-key"),
    workersAi: Boolean(env.WORKERS_AI) && !env.SAMPLE,
  };
}
