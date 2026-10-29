// Model sessions with one shared shape:
//   const s = make({ system, user, tools })   tools = [{name, description, parameters}]
//   await s.step()  -> { text, calls: [{ id, name, args }] }
//   s.addResults([{ call, result }])
// Order (src/agent.js sessions): Anthropic (Doors Agent, paid, capped), then Cloudflare Workers AI (no key), then
// Gemini (free tier key) as the backup.

const hasProps = (p) => p && p.properties && Object.keys(p.properties).length > 0;

// gemini-2.5-flash was retired for new keys in Oct 2026. Flash-lite (GA) with minimal thinking answers a tool step in
// ~1 s; gemini-3.5-flash took ~30 s per step and 503s under load. Override with GEMINI_MODEL.
export const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";

export function geminiSession({ apiKey, model = GEMINI_DEFAULT_MODEL, thinkingLevel = "minimal", fetchImpl = globalThis.fetch, timeoutMs = null }) {
  return ({ system, user, tools }) => {
    const contents = [{ role: "user", parts: [{ text: user }] }];
    const functionDeclarations = tools.map((t) => (hasProps(t.parameters) ? t : { name: t.name, description: t.description }));
    const s = {
      label: `Gemini (${model})`,
      async step(noTools = false) {
        const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}), // R9 chat agent: a step never hangs a turn
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            tools: [{ functionDeclarations }],
            ...(noTools ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
            generationConfig: { temperature: 0.4, maxOutputTokens: 4096, ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}) },
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          // live check D: the free tier's per-day quota (20 requests a model) answers 429 with "retry in 8h…": the model
          // cools that long (coolMs), not just a few minutes
          const day = res.status === 429 && /PerDay/.test(body) ? /"retryDelay":\s*"(\d+)(?:\.\d+)?s"/.exec(body) : null;
          throw Object.assign(new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`), day ? { coolMs: Number(day[1]) * 1000 } : {});
        }
        const body = await res.json();
        const content = body.candidates?.[0]?.content;
        if (!content?.parts) throw new Error(`Gemini returned no content (${body.candidates?.[0]?.finishReason ?? "unknown"})`);
        contents.push(content); // keep parts verbatim (thought signatures must round-trip)
        const calls = content.parts.filter((p) => p.functionCall).map((p, i) => ({ id: p.functionCall.id ?? `g${contents.length}-${i}`, geminiId: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args ?? {} }));
        const text = content.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
        return { text, calls };
      },
      addResults(results) {
        contents.push({ role: "user", parts: results.map(({ call, result }) => ({ functionResponse: { ...(call.geminiId ? { id: call.geminiId } : {}), name: call.name, response: { result } } })) });
      },
      // the last step of a turn whose tool steps ran out: words only (live check A)
      async answer() {
        return { text: (await s.step(true)).text, calls: [] };
      },
    };
    return s;
  };
}

// Doors Agent (spec §7, 2026-10-23): Anthropic's Messages API over fetch, no SDK. system is a string or a list of text
// blocks (the persona + rules block carries cache_control, so a turn pays full price for it once per 5 min). effort:
// "low" in drive mode, higher at a desk (adaptive thinking). serverTools: Anthropic-run tools (web search, src/brief.js),
// sent as they are. The assistant's content is kept verbatim between steps (thinking signatures, server_tool_use and
// web_search_tool_result must round-trip); stop_reason "pause_turn" is called again inside the same step.
// step() → { text, calls, content (every raw block of this step), stop }.
export const ANTHROPIC_VERSION = "2023-06-01";
export function anthropicSession({ apiKey, model = "claude-haiku-5-5", effort = "medium", serverTools = [], fetchImpl = globalThis.fetch, timeoutMs = null, maxTokens = 2048, onUsage = null, onLost = null, format = null }) {
  return ({ system, user, tools }) => {
    const messages = [{ role: "user", content: user }];
    const defs = [...tools.map((t) => ({ name: t.name, description: t.description, input_schema: hasProps(t.parameters) ? t.parameters : { type: "object", properties: {} } })), ...serverTools];
    const sys = typeof system === "string" ? [{ type: "text", text: system }] : system;
    const call = async (noTools) => {
      const body = JSON.stringify({ model, max_tokens: maxTokens, system: sys, messages, tools: defs, ...(noTools ? { tool_choice: { type: "none" } } : {}), thinking: { type: "adaptive" }, output_config: { effort, ...(format ? { format } : {}) } }); // format: structured output (src/talk.js)
      const lost = (e) => {
        // sent, never answered (a timeout): it may still be billed, so the $ guard counts it at its most (src/spend.js)
        if (onLost) onLost({ model, body, maxTokens, searches: serverTools.reduce((n, t) => n + (t.max_uses ?? 0), 0) });
        throw e;
      };
      let res;
      try {
        res = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
          ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
          body,
        });
      } catch (e) {
        lost(e);
      }
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const out = await res.json().catch(lost);
      if (onUsage) onUsage(out.usage ?? null, model);
      return out;
    };
    const s = {
      label: `Anthropic (${model})`,
      async step(noTools = false) {
        const content = [];
        let body;
        for (let i = 0; i < 3; i++) {
          body = await call(noTools);
          const blocks = body.content ?? [];
          content.push(...blocks);
          // a paused turn (a long server tool) goes on from where it stopped: its blocks are the assistant's so far
          const last = messages.at(-1);
          if (last.role === "assistant") last.content.push(...blocks);
          else messages.push({ role: "assistant", content: [...blocks] });
          if (body.stop_reason !== "pause_turn") break;
        }
        if (!content.length) throw new Error(`Anthropic returned no content (${body?.stop_reason ?? "unknown"})`);
        const calls = content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
        const text = content.filter((b) => b.type === "text").map((b) => b.text).join("");
        return { text, calls, content, stop: body.stop_reason };
      },
      addResults(results) {
        // every tool_use of the last assistant message needs its result, in the next user message
        messages.push({ role: "user", content: results.map(({ call, result }) => ({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result), ...(result?.ok === false ? { is_error: true } : {}) })) });
      },
      async answer() {
        const out = await s.step(true);
        return { text: out.text, calls: [], content: out.content };
      },
    };
    return s;
  };
}

// Workers AI answers in one of two shapes: the legacy {response, tool_calls: [{name, arguments}]}, or (2026-10, both
// Llama models) OpenAI's {choices: [{message: {content, tool_calls: [{id, function: {name, arguments}}]}}], usage}.
// Llama also sometimes writes the call as JSON in its text ({"name": …, "parameters": …}, or <function=name>{…}).
// The session reads all of them; usage feeds the neuron budget (agent.js).
export const ANSWER_NOW = "Now answer my last message in plain text from the tool results above, in at most three short sentences. Call no tool.";
export const WORKERS_AI_MODELS = { "70b": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "8b": "@cf/meta/llama-3.1-8b-instruct-fp8-fast", qwen: "@cf/qwen/qwen3-30b-a3b-fp8" };
const CANNED = /^\s*your (request|input|query|message|question)\b[^.]*\b(incomplete|lacking|lacks|insufficient|not sufficient|unclear|missing)\b|\bplease provide more (details|information|context)\b/i;
export function workersAiSession({ ai, model = WORKERS_AI_MODELS["70b"], onUsage = null, maxTokens = 512 }) {
  return ({ system, user, tools }) => {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    const defs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: hasProps(t.parameters) ? t.parameters : { type: "object", properties: {} } } }));
    const names = new Set(tools.map((t) => t.name));
    let n = 0;
    let pending = null; // the step's calls, until their results come back
    return {
      label: `Workers AI (${model.split("/").pop()})`,
      async step() {
        let out = await ai.run(model, { messages, tools: defs, max_tokens: maxTokens, temperature: 0.3 });
        if (onUsage) onUsage(out?.usage ?? null);
        let { text, calls } = readWorkersAi(out, names, () => `w${++n}`);
        // with tools declared, Llama 70b answers some short asks ("what's first today?",
        // "where do I go first?") with a canned "Your request is incomplete. Please provide more details" (5/5, no
        // call); asked again without the tools it answers from CONTEXT (measured 2/2). Once, on the first step only.
        if (!calls.length && defs.length && messages.length === 2 && CANNED.test(text)) {
          out = await ai.run(model, { messages, max_tokens: maxTokens, temperature: 0.3 });
          if (onUsage) onUsage(out?.usage ?? null);
          ({ text, calls } = readWorkersAi(out, names, () => `w${++n}`));
          if (CANNED.test(text)) text = "";
        }
        if (!text && !calls.length) throw new Error("Workers AI returned no content");
        // live check A: Llama 3.3 70b may make two calls in one step, but a history with an assistant message holding
        // two tool_calls is refused ("This model only supports single tool-calls at once!", 400): each call is
        // replayed as its own assistant message, followed by its result (addResults)
        if (!calls.length) messages.push({ role: "assistant", content: text });
        else pending = { text, calls };
        return { text, calls };
      },
      addResults(results) {
        const asked = pending?.calls ?? results.map((r) => r.call);
        asked.forEach((c, i) => {
          const r = results.find((x) => x.call.id === c.id);
          if (!r) return;
          messages.push({ role: "assistant", content: i === 0 ? (pending?.text ?? "") : "", tool_calls: [{ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] });
          messages.push({ role: "tool", tool_call_id: c.id, name: c.name, content: JSON.stringify(r.result) });
        });
        pending = null;
      },
      // the last step of a turn whose tool steps ran out: words only (live check A). The tools stay declared: without
      // them Llama 70b ignores the tool results above and answers from its own knowledge (measured); a call it makes
      // anyway is dropped
      async answer() {
        const out = await ai.run(model, { messages: [...messages, { role: "user", content: ANSWER_NOW }], tools: defs, max_tokens: maxTokens, temperature: 0.3 });
        if (onUsage) onUsage(out?.usage ?? null);
        const { text, calls } = readWorkersAi(out, names, () => `w${++n}`);
        return { text: calls.length ? "" : text, calls: [] };
      },
    };
  };
}

// → { text, calls: [{id, name, args}] } from either shape; a call written in the text is taken only for a known tool.
export function readWorkersAi(out, names, nextId) {
  const msg = out?.choices?.[0]?.message;
  let text = typeof msg?.content === "string" ? msg.content : typeof out?.response === "string" ? out.response : "";
  text = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, ""); // Qwen3's reasoning, if it writes it in the text
  const raw = msg?.tool_calls ?? out?.tool_calls ?? [];
  const argsOf = (a) => (typeof a === "string" ? safeJson(a) : a && typeof a === "object" ? a : {});
  let calls = raw.map((c) => ({ id: c.id ?? nextId(), name: c.function?.name ?? c.name, args: argsOf(c.function?.arguments ?? c.arguments ?? c.parameters) })).filter((c) => c.name);
  if (!calls.length && text) {
    const found = callsInText(text, names);
    if (found.length) {
      calls = found.map((c) => ({ id: nextId(), ...c }));
      text = "";
    }
  }
  return { text: text.trim(), calls };
}
function callsInText(text, names) {
  const out = [];
  // <function=name>{...}</function>
  for (const m of text.matchAll(/<function=([\w-]+)>\s*(\{[\s\S]*?\})\s*<\/function>/g)) if (names.has(m[1])) out.push({ name: m[1], args: safeJson(m[2]) });
  if (out.length) return out;
  // a bare JSON object (or list of them) with name + parameters/arguments, optionally fenced or after <|python_tag|>
  const body = text.replace(/<\|python_tag\|>/g, "").replace(/```(?:json)?/g, "").trim();
  if (!/^[[{]/.test(body)) return out;
  for (const part of body.split(/;\s*(?=\{)/)) {
    const j = safeJson(part.trim());
    for (const c of Array.isArray(j) ? j : [j]) {
      const name = c?.name ?? c?.function?.name;
      if (names.has(name)) out.push({ name, args: argsOf2(c.parameters ?? c.arguments ?? c.function?.arguments) });
    }
  }
  return out;
}
const argsOf2 = (a) => (typeof a === "string" ? safeJson(a) : a && typeof a === "object" ? a : {});

// Deterministic stand-in used by tests: replays a script of steps.
export function scriptedSession(steps) {
  return () => {
    let i = 0;
    const seen = [];
    return {
      label: "scripted",
      seen,
      async step() {
        const s = steps[i++];
        if (!s) throw new Error("script exhausted");
        return typeof s === "function" ? s(seen) : { text: s.text ?? "", calls: s.calls ?? [] };
      },
      addResults(results) {
        seen.push(...results);
      },
    };
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
