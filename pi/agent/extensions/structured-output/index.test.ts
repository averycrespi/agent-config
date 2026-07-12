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
  "PI_STRUCTURED_OUTPUT_MISSING_OUTPUT_REMINDERS",
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
  const userMessages: Array<{ content: string; options: unknown }> = [];
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
      sendUserMessage(content: string, options: unknown) {
        userMessages.push({ content, options });
      },
    },
    tools,
    commands,
    userMessages,
    async emit(name: string, ctx: any, event: unknown = {}) {
      for (const handler of handlers.get(name) ?? []) {
        await handler(event, ctx);
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

test("extension sends the configured number of bounded reminders when output is missing", async () => {
  const root = join(
    tmpdir(),
    `structured-output-reminder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const schemaFile = join(root, "schema.json");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(schemaFile, JSON.stringify({ type: "object" }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE = schemaFile;
  process.env.PI_STRUCTURED_OUTPUT_MISSING_OUTPUT_REMINDERS = "2";

  try {
    const harness = makePi();
    structuredOutputExtension(harness.pi as any);
    const ctx = {
      cwd,
      isIdle: () => true,
      hasPendingMessages: async () => false,
    };
    await harness.emit("session_start", ctx);
    await harness.emit("agent_settled", ctx);
    await harness.emit("before_agent_start", ctx);
    await harness.emit("agent_settled", ctx);
    await harness.emit("before_agent_start", ctx);
    await harness.emit("agent_settled", ctx);

    assert.equal(harness.userMessages.length, 2);
    assert.match(harness.userMessages[0]!.content, /structured_output/);
    assert.deepEqual(harness.userMessages[0]!.options, {
      deliverAs: "followUp",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension suppresses reminders for terminal provider errors and recovers after retry", async () => {
  const root = join(
    tmpdir(),
    `structured-output-provider-error-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const schemaFile = join(root, "schema.json");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(schemaFile, JSON.stringify({ type: "object" }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE = schemaFile;

  try {
    const harness = makePi();
    structuredOutputExtension(harness.pi as any);
    const ctx = {
      cwd,
      isIdle: () => true,
      hasPendingMessages: async () => false,
    };
    await harness.emit("session_start", ctx);
    await harness.emit("agent_end", ctx, {
      messages: [
        { role: "assistant", stopReason: "error", errorMessage: "unavailable" },
      ],
    });
    await harness.emit("agent_settled", ctx);
    assert.deepEqual(harness.userMessages, []);

    await harness.emit("agent_end", ctx, {
      messages: [{ role: "assistant", stopReason: "stop" }],
    });
    await harness.emit("agent_settled", ctx);
    assert.equal(harness.userMessages.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension does not remind after structured output is captured", async () => {
  const root = join(
    tmpdir(),
    `structured-output-captured-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  const schemaFile = join(root, "schema.json");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(schemaFile, JSON.stringify({ type: "object" }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE = schemaFile;

  try {
    const harness = makePi();
    structuredOutputExtension(harness.pi as any);
    const ctx = { cwd, isIdle: () => true };
    await harness.emit("session_start", ctx);
    await harness.tools[0].execute("tool-1", {});
    await harness.emit("agent_settled", ctx);

    assert.deepEqual(harness.userMessages, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension wraps non-object root schemas for provider tools and unwraps values", async () => {
  const schemasAndValues: Array<[Record<string, unknown>, unknown]> = [
    [{ type: "null" }, null],
    [{ type: "boolean" }, true],
    [{ type: "number" }, 1.5],
    [{ type: "integer" }, 2],
    [{ type: "string" }, "done"],
    [{ type: "array", items: { type: "string" } }, ["done"]],
    [{}, { arbitrary: true }],
  ];

  for (const [schema, value] of schemasAndValues) {
    const root = join(
      tmpdir(),
      `structured-output-envelope-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    const schemaFile = join(root, "schema.json");
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(schemaFile, JSON.stringify(schema));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE = schemaFile;

    try {
      const harness = makePi();
      structuredOutputExtension(harness.pi as any);
      await harness.emit("session_start", { cwd });

      assert.equal(harness.tools[0].parameters.type, "object");
      assert.deepEqual(harness.tools[0].parameters.required, ["value"]);
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(harness.tools[0].parameters.properties.value),
        ),
        schema,
      );
      assert.equal(harness.tools[0].parameters.additionalProperties, false);
      const result = await harness.tools[0].execute("tool-1", { value });
      assert.deepEqual(result.details, { value });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
