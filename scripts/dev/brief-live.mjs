// Live check of src/brief.js's agent hooks, standing in for the agent's Anthropic session:
// one Haiku call with the specialist brief's system block, WEB_RULES and the web_search server tool; prints the reply,
// the web facts (each with its link) and the cost estimate. Reads the brief from the dev KV (data/kv-dev/).
// Usage: node scripts/dev/brief-live.mjs "<what>" "<city>" "<ask>" [model]   (the key from ~/.config/gigbot/anthropic-key)
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { briefForTurn, briefPrompt, webSearchTool, webFacts, WEB_RULES, PRICE } from "../../src/brief.js";

const [what, city, ask, model = "claude-haiku-5-5"] = process.argv.slice(2);
const dir = new URL("../../data/kv-dev/", import.meta.url).pathname;
const f = (k) => join(dir, createHash("sha256").update(k).digest("hex").slice(0, 24) + ".json");
const env = { DOORS_KV: { get: async (k) => (existsSync(f(k)) ? JSON.parse(readFileSync(f(k), "utf8")) : null) } };
const ctx = { profile: { what }, city: { name: city } };
const brief = await briefForTurn(env, ctx);
console.log(`brief: ${brief.status} (${brief.category}, ${brief.city})`);
const key = readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();
const system = [
  { type: "text", text: `You coach a drinks sales rep visiting bars (doors) in ${city}. Plain, warm, brief: at most three sentences. ${WEB_RULES}` },
  ...(briefPrompt(brief) ? [{ type: "text", text: briefPrompt(brief), cache_control: { type: "ephemeral" } }] : []),
];
const t0 = Date.now();
const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 3000, system, tools: [webSearchTool(ctx, {}, "dev")], messages: [{ role: "user", content: ask }] }) });
const b = await res.json();
if (!res.ok) throw new Error(JSON.stringify(b).slice(0, 300));
const ms = Date.now() - t0;
const reply = b.content.filter((c) => c.type === "text").map((c) => c.text).join("");
const u = b.usage;
const usd = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0)) * PRICE.in + (u.cache_read_input_tokens ?? 0) * PRICE.in * 0.1 + u.output_tokens * PRICE.out) / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * PRICE.search;
console.log(`\nASK: ${ask}\nREPLY (${ms} ms, ${u.server_tool_use?.web_search_requests ?? 0} searches, ${u.input_tokens}+${u.cache_read_input_tokens ?? 0}cached+${u.output_tokens} tokens, ~$${usd.toFixed(4)}):\n${reply}\n\nFACTS:`);
for (const x of webFacts(b.content, "dev")) console.log(`- [${x.label}] ${x.text}\n  ${x.url}`);
