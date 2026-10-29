// A stand-in for fetch("https://api.anthropic.com/v1/messages") that runs the request through headless Claude Code
// (`claude -p`) on the owner's Max plan instead of the API key: no API credit is spent (Jard 10-27). Node only (it
// spawns a process); never imported by the Worker. Plugged in as env.ANTHROPIC_FETCH, so src/talk.js talkTurn (and
// anything else on src/llm.js anthropicSession) runs unchanged: same prompt, same JSON schema, same checks, same
// retries, same ledger. The reply is shaped like the Messages API: one text block holding the structured output.
//   --setting-sources "" is required: without it the call loads the owner's private CLAUDE.md into the model's
//   context (and with it apiKeySource stays "none", i.e. the Max plan). --tools "" : no tools, one turn.
//   --no-session-persistence: thousands of calls must not pile up as saved sessions.
// A usage-limit or any other CLI failure comes back as a non-ok response whose text carries the CLI's words, so the
// caller's STOP rule (scripts/talk-bake.mjs STOP_ERROR) sees "limit" and stops the run.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CC_MODELS = { "claude-sonnet-5-5": "sonnet", "claude-opus-5-5": "opus", "claude-haiku-4-5-20251001": "haiku" };
const CWD = join(tmpdir(), "doors-claude-code"); // an empty folder: no project files for the CLI to read
mkdirSync(CWD, { recursive: true });

export const ccCalls = []; // {ms, model, usage, cost, error?} per call, for the pilot's report
// SAFETY (gigbot 10-27): the Max plan is shared by every agent on the box. The first usage-limit, rate-limit or
// "approaching the limit" answer from the CLI stops everything: the call fails, every later call fails at once without
// spawning the CLI (nothing retries through it), and the scripts see ccLimitHit() and end their run (exit 2).
// "overloaded" (the API's 529) is not a plan limit and is left to the caller's own transient rule.
let limit = null;
export const ccLimitHit = () => limit;
export const LIMIT_RE = /usage limit|rate limit|approaching .{0,40}limit|limit (has been |was |is )?(reached|exceeded|hit)|out of (usage|quota|credits)|too many requests|\b429\b|resets? (at|in) \d|hit your .{0,30}limit|you'?ve (reached|hit) .{0,30}limit|quota/i;
const limitIn = (...texts) => { const m = LIMIT_RE.exec(texts.filter(Boolean).join("\n")); return m ? m[0] : null; };
export function makeClaudeCodeFetch({ timeoutMs = 300000, bin = "claude", log = null } = {}) {
  return async (url, init = {}) => {
    const req = JSON.parse(init.body ?? "{}");
    const system = (Array.isArray(req.system) ? req.system.map((b) => b.text ?? "").join("\n") : String(req.system ?? "")).trim();
    const user = req.messages?.[0]?.content;
    const userText = typeof user === "string" ? user : (user ?? []).map((b) => b.text ?? "").join("\n");
    const schema = req.output_config?.format?.schema ?? null;
    const effort = req.output_config?.effort ?? "medium";
    const model = CC_MODELS[req.model] ?? req.model;
    const args = ["-p", "--setting-sources", "", "--model", model, "--effort", effort, "--tools", "", "--no-session-persistence", "--output-format", "json", "--system-prompt", system, ...(schema ? ["--json-schema", JSON.stringify(schema)] : [])];
    if (limit) return { ok: false, status: 429, text: async () => `stopped: ${limit}`, json: async () => ({ error: limit }) };
    const t0 = Date.now();
    const r = spawnSync(bin, args, { input: userText, encoding: "utf8", cwd: CWD, timeout: timeoutMs, maxBuffer: 64e6, env: { ...process.env, ANTHROPIC_API_KEY: "" } });
    const ms = Date.now() - t0;
    const fail = (status, text) => {
      ccCalls.push({ ms, model: req.model, error: text.slice(0, 200) });
      if (log) log(`[claude-code] ${status}: ${text.slice(0, 160)}`);
      return { ok: false, status, text: async () => text, json: async () => ({ error: text }) };
    };
    if (r.error) return fail(599, `claude -p: ${r.error.message}`);
    let out = null;
    try { out = JSON.parse(r.stdout); } catch {}
    const hit = limitIn(out?.is_error || out?.subtype !== "success" ? String(out?.result ?? "") : "", r.stderr, out ? "" : r.stdout);
    if (hit) {
      limit = `${hit}: ${String(out?.result ?? r.stderr ?? r.stdout ?? "").replace(/\s+/g, " ").slice(0, 200)}`;
      if (log) log(`[claude-code] LIMIT: ${limit}`);
      return fail(429, `usage limit from claude -p: ${limit}`);
    }
    if (!out) return fail(r.status === 0 ? 502 : 500, `claude -p exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 300)}`);
    if (out.is_error || out.subtype !== "success") return fail(out.api_error_status ?? 500, `claude -p ${out.subtype ?? "error"}: ${String(out.result ?? "").slice(0, 300)}`);
    const text = out.structured_output ? JSON.stringify(out.structured_output) : String(out.result ?? "");
    const usage = out.usage ? { input_tokens: out.usage.input_tokens ?? 0, output_tokens: out.usage.output_tokens ?? 0, cache_read_input_tokens: out.usage.cache_read_input_tokens ?? 0, cache_creation_input_tokens: out.usage.cache_creation_input_tokens ?? 0 } : null;
    ccCalls.push({ ms, model: req.model, usage, cost: out.total_cost_usd ?? null, thinking: out.usage?.output_tokens_details?.thinking_tokens ?? null });
    const body = { id: out.uuid ?? "cc", type: "message", role: "assistant", model: req.model, content: [{ type: "text", text }], stop_reason: out.stop_reason ?? "end_turn", usage };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
}
