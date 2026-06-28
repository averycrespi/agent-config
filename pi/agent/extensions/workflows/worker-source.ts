export function buildWorkerSource(executableScript: string): string {
  return (
    `
import { parentPort, workerData } from "node:worker_threads";

const process = undefined;
const require = undefined;
const global = undefined;
const globalThis = undefined;
const Buffer = undefined;
const setTimeout = undefined;
const setInterval = undefined;
const setImmediate = undefined;
const fetch = undefined;
const WebSocket = undefined;
const Worker = undefined;

let nextRequestId = 1;
const pending = new Map();

function post(message) {
  parentPort.postMessage(message);
}

class WorkflowAgentError extends Error {
  constructor(response) {
    super(response?.error || "agent failed");
    this.code = response?.errorCode || "subagent_failed";
    this.details = response?.errorDetails;
  }
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "agent-response") return;
  const entry = pending.get(message.requestId);
  if (!entry) return;
  pending.delete(message.requestId);
  if (message.response?.ok) {
    entry.resolve(message.response.hasStructured ? message.response.value : message.response.text);
  } else entry.reject(new WorkflowAgentError(message.response));
});

const args = workerData.args;
const cwd = workerData.cwd;

function serialize(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function serializeError(error) {
  return {
    code: error?.code || "workflow_script_error",
    message: error?.message || String(error),
    ...(error?.details ? { details: error.details } : {}),
  };
}

function log(message) {
  post({ type: "log", level: "info", message: serialize(message) });
}

function phase(name) {
  if (typeof name !== "string" || !name.trim()) throw new Error("phase name must be a non-empty string");
  post({ type: "phase", name: name.trim() });
}

async function agent(prompt, options = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("agent prompt must be a non-empty string");
  if (options == null || typeof options !== "object" || Array.isArray(options)) throw new Error("agent options must be an object");
  const allowed = new Set(["agent", "intent", "output", "retries"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(` +
    "`agent option ${key} is not allowed`" +
    `);
  }
  const requestId = nextRequestId++;
  post({ type: "agent", requestId, prompt, agent: options.agent, intent: options.intent, output: options.output, retries: options.retries });
  return await new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

async function runParallel(thunks, options, settle) {
  if (!Array.isArray(thunks)) throw new Error(settle ? "parallelSettled expects an array of thunks" : "parallel expects an array of thunks");
  const max = Math.max(1, Math.min(Number(options.concurrency ?? workerData.maxConcurrency) || workerData.maxConcurrency, workerData.maxConcurrency));
  const results = new Array(thunks.length).fill(null);
  let next = 0;
  async function runOne() {
    while (next < thunks.length) {
      const index = next++;
      const thunk = thunks[index];
      if (typeof thunk !== "function") throw new Error(settle ? "parallelSettled entries must be functions" : "parallel entries must be functions");
      try {
        const value = await thunk();
        results[index] = settle ? { ok: true, value } : value;
      }
      catch (error) {
        const serialized = serializeError(error);
        if (settle) results[index] = { ok: false, error: serialized };
        else { post({ type: "log", level: "error", message: serialized.message }); results[index] = null; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(max, thunks.length) }, runOne));
  return results;
}

async function parallel(thunks, options = {}) {
  return await runParallel(thunks, options, false);
}

async function parallelSettled(thunks, options = {}) {
  return await runParallel(thunks, options, true);
}

async function pipeline(items, ...stages) {
  if (!Array.isArray(items)) throw new Error("pipeline expects an array of items");
  if (stages.some((stage) => typeof stage !== "function")) throw new Error("pipeline stages must be functions");
  return await parallel(items.map((item, index) => async () => {
    let value = item;
    for (const stage of stages) value = await stage(value, index);
    return value;
  }));
}

${executableScript}

let __workflowResult;
if (typeof run === "function") {
  __workflowResult = await run();
}
post({ type: "result", result: __workflowResult });
`
  );
}
