export function buildWorkerSource(executableScript: string): string {
  const workflowBody = `"use strict";\n${executableScript}\nreturn typeof run === "function" ? await run() : undefined;`;
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

class WorkflowReportError extends Error {
  constructor(reasons) {
    const suffix = reasons.length ? ": " + reasons.join("; ") : "";
    super("workflow report rejected" + suffix);
    this.code = "workflow_report_rejected";
    this.details = { reasons };
  }
}

let budgetSnapshot = Object.freeze({ ...workerData.budget });

parentPort.on("message", (message) => {
  if (!message) return;
  if (message.type === "budget-update") {
    budgetSnapshot = Object.freeze({ ...message.budget });
    return;
  }
  if (message.type !== "agent-response") return;
  const entry = pending.get(message.requestId);
  if (!entry) return;
  pending.delete(message.requestId);
  if (message.response?.ok) {
    entry.resolve(message.response.hasStructured ? message.response.value : message.response.text);
  } else entry.reject(new WorkflowAgentError(message.response));
});

const args = workerData.args;
const cwd = workerData.cwd;
const budget = Object.freeze({
  get total() { return budgetSnapshot.total; },
  spent: Object.freeze(() => budgetSnapshot.used),
  remaining: Object.freeze(() => budgetSnapshot.total === null ? Infinity : Math.max(0, budgetSnapshot.total - budgetSnapshot.used)),
  get launched() { return budgetSnapshot.launched; },
  get maxAgents() { return budgetSnapshot.maxAgents; },
});

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
  const allowed = new Set(["agent", "intent", "output", "model", "retries", "timeoutMs"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(` +
    "`agent option ${key} is not allowed`" +
    `);
  }
  if (options.model !== undefined && typeof options.model !== "string") throw new Error("agent model must be a string alias");
  const requestId = nextRequestId++;
  post({ type: "agent", requestId, prompt, agent: options.agent, intent: options.intent, output: options.output, model: options.model, retries: options.retries, timeoutMs: options.timeoutMs });
  return await new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

const verifierOutput = {
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["confirmed", "reasons"],
    properties: {
      confirmed: { type: "boolean" },
      reasons: { type: "array", items: { type: "string" } },
    },
  },
};

async function verify(claim, options = {}) {
  if (typeof claim !== "string" || !claim.trim()) throw new Error("verify claim must be a non-empty string");
  if (options == null || typeof options !== "object" || Array.isArray(options)) throw new Error("verify options must be an object");
  const allowed = new Set(["agent", "intent", "context", "model", "retries", "timeoutMs"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error(` +
    "`verify option ${key} is not allowed`" +
    `);
  }
  const context = options.context === undefined ? "" : "\\n\\nContext:\\n" + serialize(options.context);
  const verdict = await agent(
    "Adversarially verify the following claim using available evidence. Confirm it only when the evidence supports every material part. Return concise reasons for the verdict.\\n\\nClaim:\\n" + claim.trim() + context,
    {
      agent: options.agent ?? "reviewer",
      intent: options.intent ?? "Verify claim",
      output: verifierOutput,
      model: options.model,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    },
  );
  return { ok: verdict.confirmed, reasons: verdict.reasons };
}

async function report(value, options) {
  if (options == null || typeof options !== "object" || Array.isArray(options) || typeof options.gate !== "function") {
    throw new Error("report options must contain a callable gate");
  }
  if (Object.keys(options).some((key) => key !== "gate")) throw new Error("report only accepts the gate option");
  const verdict = await options.gate(value);
  if (verdict === true || (verdict !== null && typeof verdict === "object" && !Array.isArray(verdict) && verdict.ok === true)) return value;
  const reasons = verdict !== null && typeof verdict === "object" && !Array.isArray(verdict) && Array.isArray(verdict.reasons)
    ? verdict.reasons.filter((reason) => typeof reason === "string")
    : [];
  throw new WorkflowReportError(reasons);
}

function concurrencyLimit(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return workerData.maxConcurrency;
  return Math.min(value, workerData.maxConcurrency);
}

async function runParallel(thunks, options, settle) {
  if (!Array.isArray(thunks)) throw new Error(settle ? "parallelSettled expects an array of thunks" : "parallel expects an array of thunks");
  const max = concurrencyLimit(options.concurrency ?? workerData.maxConcurrency);
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
        post({ type: "branch-failure", settled: settle });
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

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflowMain = new AsyncFunction(
  "agent", "verify", "report", "budget", "parallel", "parallelSettled", "pipeline", "phase", "log", "args", "cwd",
  "process", "require", "global", "globalThis", "Buffer", "setTimeout", "setInterval", "setImmediate", "fetch", "XMLHttpRequest", "WebSocket", "Worker", "importScripts",
  ${JSON.stringify(workflowBody)},
);
const __workflowResult = await workflowMain(
  agent, verify, report, budget, parallel, parallelSettled, pipeline, phase, log, args, cwd,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
);
post({ type: "result", result: __workflowResult });
`
  );
}
