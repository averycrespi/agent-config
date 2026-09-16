import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEventBus,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { TestContext } from "node:test";
import {
  executeScript,
  registerScriptProvider,
  type ScriptMethod,
  type ScriptOptions,
} from "./api.ts";

export const limits = { maxCalls: 8, maxConcurrency: 2, timeoutMs: 3000 };
export const tupleSchema = {
  type: "array",
  items: [{ type: "integer" }],
  minItems: 1,
  maxItems: 1,
  additionalItems: false,
};
export async function fixture(
  t: TestContext,
  methods?: Record<string, ScriptMethod>,
) {
  const dir = await mkdtemp(join(tmpdir(), "pi-script-test-"));
  const env = { ...process.env };
  process.env.PI_CODING_AGENT_DIR = dir;
  for (const name of [
    "SCRIPT_ALLOWED_PROVIDERS",
    "SCRIPT_MAX_CALLS",
    "SCRIPT_MAX_CONCURRENCY",
    "SCRIPT_TIMEOUT_MS",
  ])
    delete process.env[name];
  const pi = { events: createEventBus() } as Pick<ExtensionAPI, "events">;
  const config = async (value: unknown) =>
    writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ "extension:script": value }),
    );
  await config({ allowedProviders: ["fixture"] });
  let available = true;
  const dispose = methods
    ? registerScriptProvider(pi, {
        namespace: "fixture",
        methods,
        available: () => available,
      })
    : () => {};
  t.after(async () => {
    dispose();
    process.env = env;
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    pi,
    config,
    dispose,
    unavailable: () => {
      available = false;
    },
    run: (source: string, options: Partial<ScriptOptions> = {}) =>
      executeScript(pi, dir, {
        source,
        providers: methods ? ["fixture"] : [],
        limits,
        signal: new AbortController().signal,
        deadlineMs: Date.now() + 5000,
        ...options,
      }),
  };
}
export const echo: ScriptMethod = {
  description: "Return the integer argument",
  inputSchema: tupleSchema,
  handler: async (args) => ({ value: args[0] }),
};
