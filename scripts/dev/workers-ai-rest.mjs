// Dev only (never imported by src/): an env.AI stand-in that calls Cloudflare Workers AI over REST, so the real agent
// loop and tools run locally on the free models. Reads ~/.config/gigbot/cloudflare-{token,account-id} (never printed).
// Usage: const ai = workersAiRest(); env.AI = ai; ai.usage → [{model, prompt_tokens, completion_tokens, neurons, ms}]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// developers.cloudflare.com/workers-ai/platform/pricing (read 2026-10-22): neurons per million tokens, [in, out]
export const NEURONS_PER_M = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26668, 204805],
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": [4119, 34868],
  "@cf/meta/llama-3.1-8b-instruct-fast": [4119, 34868], // not in the table; assumed the fp8-fast row
  "@cf/qwen/qwen3-30b-a3b-fp8": [4625, 30475],
  "@cf/meta/llama-4-scout-17b-16e-instruct": [24545, 77273],
  "@cf/mistralai/mistral-small-3.1-24b-instruct": [31876, 50488],
  "@cf/openai/gpt-oss-20b": [18182, 27273],
};
export const neuronsOf = (model, u) => {
  const [i, o] = NEURONS_PER_M[model] ?? [NaN, NaN];
  return ((u?.prompt_tokens ?? 0) * i + (u?.completion_tokens ?? 0) * o) / 1e6;
};

export function workersAiRest({ token, account, fetchImpl = globalThis.fetch } = {}) {
  const cfg = (f) => readFileSync(join(homedir(), ".config/gigbot", f), "utf8").trim();
  token ??= cfg("cloudflare-token");
  account ??= cfg("cloudflare-account-id");
  const usage = [];
  return {
    usage,
    async run(model, input) {
      const t0 = Date.now();
      const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      // Aura-2 answers with the audio itself (audio/mpeg), as the binding's stream would carry it
      if (res.ok && /^audio\//.test(res.headers.get("content-type") ?? "")) return usage.push({ model, ms: Date.now() - t0 }), new Uint8Array(await res.arrayBuffer());
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success === false) throw new Error(`Workers AI ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
      const out = body.result ?? {};
      usage.push({ model, ...(out.usage ?? {}), neurons: neuronsOf(model, out.usage), ms: Date.now() - t0 });
      return out;
    },
  };
}
