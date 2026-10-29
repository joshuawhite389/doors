// Cost guard test helper (not a test file): one Worker "isolate" in a worker thread, with its own module state, whose
// SPEND_BOOK binding reaches the one SpendBook the test holds in the main thread. Commands: turn | debrief | brief.
import { parentPort, workerData } from "node:worker_threads";

globalThis.fetch = async (u) => {
  throw new Error(`network call attempted in a test: ${u}`);
};
const worker = (await import("../src/worker.js")).default;
const { debriefTurn } = await import("../src/agent.js");
const { ensureBrief } = await import("../src/brief.js");
const { demoContext } = await import("./agent-fixture.mjs");

let n = 0;
const waiting = new Map();
parentPort.on("message", (m) => {
  if (m.rpc) return waiting.get(m.rpc)?.(m), waiting.delete(m.rpc);
  run(m).then((out) => parentPort.postMessage({ id: m.id, out }), (e) => parentPort.postMessage({ id: m.id, error: String(e?.stack ?? e) }));
});
const SPEND_BOOK = {
  idFromName: (name) => name,
  get: () => ({
    fetch: (url, init = {}) =>
      new Promise((resolve) => {
        const rpc = `${workerData.name}-${++n}`;
        waiting.set(rpc, (r) => resolve(new Response(r.text, { status: r.status })));
        parentPort.postMessage({ rpc, url, method: init.method ?? "GET", body: init.body ?? null });
      }),
  }),
};
// every Claude answer costs about $0.30 on Haiku (600k output tokens, a short prompt)
const usage = { input_tokens: 1000, output_tokens: 600_000 };
const claude = (text) => async () => Response.json({ id: "m", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", usage });
const env = {
  ANTHROPIC_API_KEY: "sk-test",
  ANTHROPIC_FETCH: claude("Ask for the buyer, then one case in the cooler."),
  AI: { run: async () => ({ response: "Ask for the buyer." }) },
  WORKERS_AI_MODELS: "70b",
  AGENT_USD_DAILY: "1",
  AGENT_MODEL: "claude-haiku-5-5", // the test's $0.30 answers are priced as Haiku (round 3 made Sonnet the default)
  TODAY: "2026-10-24",
  SPEND_BOOK,
};
const { ctx } = await demoContext({ current: "first" });
const kv = () => {
  const m = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => void m.set(k, v) };
};

async function run(m) {
  if (m.cmd === "turn") {
    const req = new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": `203.0.113.${workerData.ip}` }, body: JSON.stringify({ v: 1, messages: [{ role: "user", text: "how do I pitch this place?" }], context: ctx }) });
    const r = await (await worker.fetch(req, env)).json();
    return { by: r.by, notice: r.notice ?? null, usd: r.cost?.usd ?? 0 };
  }
  if (m.cmd === "debrief") {
    const e = { ...env, ANTHROPIC_FETCH: claude('{"summary": "One door visited.", "doors": [], "next": []}') };
    const r = await debriefTurn({ facts: { date: "2026-10-24", doors: [{ id: "a1", name: "The Drafting Room", status: "visited", resultLabel: "Interested" }] }, env: e });
    const { settled } = await import("../src/spend.js");
    await settled();
    return { polished: Boolean(r.polished), message: r.message ?? null };
  }
  if (m.cmd === "brief") {
    const r = await ensureBrief({ ...env, DOORS_KV: kv() }, "IPA", "Boise, ID", { fetchImpl: claude("TRADE\nToo short.") });
    if (r.work) await r.work;
    return { status: r.state.status, reason: r.state.reason ?? null };
  }
  throw new Error(`unknown command ${m.cmd}`);
}
parentPort.postMessage({ ready: true });
