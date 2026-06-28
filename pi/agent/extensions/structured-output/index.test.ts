import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import structuredOutputExtension from "./index.ts";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "./api.ts";

const ENV_NAMES = [
  "PI_STRUCTURED_OUTPUT_SCHEMA_FILE",
  "PI_STRUCTURED_OUTPUT_TERMINATE",
  "PI_CODING_AGENT_DIR",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const name of ENV_NAMES) savedEnv.set(name, process.env[name]);

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = savedEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function makePi() {
  const handlers = new Map<string, Function[]>();
  const tools: any[] = [];
  const commands: string[] = [];
  return {
    pi: {
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      on(name: string, handler: Function) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      },
    },
    tools,
    commands,
    async emit(name: string, ctx: any) {
      for (const handler of handlers.get(name) ?? []) {
        await handler({}, ctx);
      }
    },
  };
}

test("extension is a no-op when no schema file is configured", async () => {
  delete process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE;
  delete process.env.PI_STRUCTURED_OUTPUT_TERMINATE;
  const root = join(
    tmpdir(),
    `structured-output-noop-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const harness = makePi();
    structuredOutputExtension(harness.pi as any);
    await harness.emit("session_start", { cwd });
    await harness.emit("before_agent_start", { cwd });

    assert.deepEqual(harness.tools, []);
    assert.deepEqual(harness.commands, ["structured-output-config"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension registers structured_output when schema file is configured", async () => {
  const root = join(
    tmpdir(),
    `structured-output-active-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const schemaFile = join(root, "schema.json");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    schemaFile,
    JSON.stringify({
      type: "object",
      required: ["summary"],
      properties: { summary: { type: "string" } },
      additionalProperties: false,
    }),
  );
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE = schemaFile;
  process.env.PI_STRUCTURED_OUTPUT_TERMINATE = "0";

  try {
    const harness = makePi();
    structuredOutputExtension(harness.pi as any);
    await harness.emit("session_start", { cwd });
    await harness.emit("before_agent_start", { cwd });

    assert.equal(harness.tools.length, 1);
    assert.equal(harness.tools[0].name, STRUCTURED_OUTPUT_TOOL_NAME);
    assert.equal(harness.tools[0].label, "Structured Output");
    const result = await harness.tools[0].execute("tool-1", {
      summary: "done",
    });
    assert.deepEqual(result.details, { value: { summary: "done" } });
    assert.equal(result.terminate, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension skips invalid schema files", async () => {
  const root = join(
    tmpdir(),
    `structured-output-invalid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const schemaFile = join(root, "schema.json");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(schemaFile, "[]");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE = schemaFile;

  try {
    const harness = makePi();
    structuredOutputExtension(harness.pi as any);
    await harness.emit("session_start", { cwd });

    assert.deepEqual(harness.tools, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
