export const MAX_WORKFLOW_LOG_ENTRIES = 100;
export const MAX_WORKFLOW_LOG_MESSAGE_CHARS = 2_000;
export const MAX_WORKFLOW_PHASE_ENTRIES = 100;
export const MAX_WORKFLOW_PHASE_CHARS = 200;

export function buildSandboxSource(executableScript: string): string {
  const workflowModule = `${executableScript}\nif (typeof run !== "function") { const error = new Error("workflow run() must return a result"); error.code = "workflow_missing_result"; throw error; }\nexport const __workflowResult = await run();\nif (__workflowResult === undefined) { const error = new Error("workflow run() must return a result; return null for an explicit empty result"); error.code = "workflow_missing_result"; throw error; }`;
  const workflowModuleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(workflowModule)}`;
  return `
import nodeProcess from "node:process";

const sandboxGlobal = globalThis;
let resolveInit;
const earlyMessages = [];
let receiveMessage = (message) => earlyMessages.push(message);
const initPromise = new Promise((resolve) => { resolveInit = resolve; });

nodeProcess.on("message", (message) => {
  if (message?.type === "workflow-init" && resolveInit) {
    const resolve = resolveInit;
    resolveInit = undefined;
    resolve(message.workerData);
    return;
  }
  receiveMessage(message);
});

function post(message) {
  structuredClone(message);
  if (!nodeProcess.send) throw new Error("workflow sandbox IPC is unavailable");
  nodeProcess.send(message);
}

async function postTerminal(message) {
  structuredClone(message);
  if (!nodeProcess.send) throw new Error("workflow sandbox IPC is unavailable");
  await new Promise((resolve, reject) => {
    nodeProcess.send(message, (error) => error ? reject(error) : resolve());
  });
}

post({ type: "sandbox-ready" });
const workerData = await initPromise;

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

let nextRequestId = 1;
const pending = new Map();
let budgetSnapshot = Object.freeze({ ...workerData.budget });

function handleMessage(message) {
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
}

receiveMessage = handleMessage;
for (const message of earlyMessages.splice(0)) handleMessage(message);

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

const droppedCloneValue = Symbol("droppedCloneValue");

function cloneSafe(value, seen = new WeakMap()) {
  if (typeof value === "function" || typeof value === "symbol") return droppedCloneValue;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const clone = [];
    seen.set(value, clone);
    for (const item of value) {
      const cloned = cloneSafe(item, seen);
      clone.push(cloned === droppedCloneValue ? undefined : cloned);
    }
    return clone;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    try { return structuredClone(value); } catch { return undefined; }
  }
  const clone = {};
  seen.set(value, clone);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !("value" in descriptor)) continue;
    const cloned = cloneSafe(descriptor.value, seen);
    if (cloned !== droppedCloneValue) clone[key] = cloned;
  }
  return clone;
}

function readOwnDataValue(value, key) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return droppedCloneValue;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : droppedCloneValue;
  } catch {
    return droppedCloneValue;
  }
}

function serializeError(error) {
  const rawCode = readOwnDataValue(error, "code");
  const rawMessage = readOwnDataValue(error, "message");
  const rawDetails = readOwnDataValue(error, "details");
  const code = typeof rawCode === "string" && rawCode ? rawCode : "workflow_script_error";
  const details = rawDetails === droppedCloneValue ? undefined : cloneSafe(rawDetails);
  const message = typeof rawMessage === "string" && rawMessage
    ? rawMessage
    : typeof error === "string" && error
      ? error
      : "workflow script failed";
  return {
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
}

let workflowLogCount = 0;
function postLog(level, message) {
  if (workflowLogCount >= ${MAX_WORKFLOW_LOG_ENTRIES}) throw new Error("workflow log limit exceeded");
  workflowLogCount += 1;
  post({ type: "log", level, message: String(message).slice(0, ${MAX_WORKFLOW_LOG_MESSAGE_CHARS}) });
}

function log(message) {
  postLog("info", serialize(message));
}

let workflowPhaseCount = 0;
function phase(name) {
  if (typeof name !== "string" || !name.trim()) throw new Error("phase name must be a non-empty string");
  if (workflowPhaseCount >= ${MAX_WORKFLOW_PHASE_ENTRIES}) throw new Error("workflow phase limit exceeded");
  workflowPhaseCount += 1;
  post({ type: "phase", name: name.trim().slice(0, ${MAX_WORKFLOW_PHASE_CHARS}) });
}

async function agent(prompt, options = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("agent prompt must be a non-empty string");
  if (options == null || typeof options !== "object" || Array.isArray(options)) throw new Error("agent options must be an object");
  const allowed = new Set(["agent", "intent", "output", "model", "retries", "timeoutMs"]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) throw new Error("agent option " + key + " is not allowed");
  }
  if (options.model !== undefined && typeof options.model !== "string") throw new Error("agent model must be a string alias");
  const requestId = nextRequestId++;
  const message = { type: "agent", requestId, prompt, agent: options.agent, intent: options.intent, output: options.output, model: options.model, retries: options.retries, timeoutMs: options.timeoutMs };
  structuredClone(message);
  const response = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
  try {
    post(message);
  } catch (error) {
    pending.delete(requestId);
    throw error;
  }
  return await response;
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
    if (!allowed.has(key)) throw new Error("verify option " + key + " is not allowed");
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

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function report(value, options) {
  if (options == null || typeof options !== "object" || Array.isArray(options) || typeof options.gate !== "function") {
    throw new Error("report options must contain a callable gate");
  }
  if (Object.keys(options).some((key) => key !== "gate")) throw new Error("report only accepts the gate option");
  const verdict = await options.gate(value);
  if (verdict === true || (verdict !== null && typeof verdict === "object" && !Array.isArray(verdict) && verdict.ok === true)) return value;
  const reasons = isPlainObject(verdict) && Array.isArray(verdict.reasons)
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
      } catch (error) {
        const serialized = serializeError(error);
        post({ type: "branch-failure", settled: settle });
        if (settle) results[index] = { ok: false, error: serialized };
        else {
          postLog("error", serialized.message);
          results[index] = null;
        }
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

const safeMath = Object.create(null);
for (const key of Object.getOwnPropertyNames(Math)) {
  if (key !== "random") Object.defineProperty(safeMath, key, Object.getOwnPropertyDescriptor(Math, key));
}
Object.freeze(safeMath);

const globals = { agent, verify, report, budget, parallel, parallelSettled, pipeline, phase, log, args, cwd };
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(sandboxGlobal, name, { value, writable: false, configurable: false });
}
Object.defineProperty(sandboxGlobal, "Math", { value: safeMath, writable: false, configurable: false });
Object.defineProperty(sandboxGlobal, "process", { value: undefined, writable: false, configurable: false });

let terminalMessage;
try {
  const workflowModule = await import(${JSON.stringify(workflowModuleUrl)});
  terminalMessage = { type: "result", result: workflowModule.__workflowResult };
  try {
    structuredClone(terminalMessage);
  } catch {
    terminalMessage = {
      type: "script-error",
      error: {
        code: "workflow_script_error",
        message: "workflow result must be structured-cloneable",
      },
    };
  }
} catch (error) {
  terminalMessage = { type: "script-error", error: serializeError(error) };
}
try {
  await postTerminal(terminalMessage);
} finally {
  nodeProcess.disconnect();
}
`;
}
