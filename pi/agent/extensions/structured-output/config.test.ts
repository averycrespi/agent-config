import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_STRUCTURED_OUTPUT_CONFIG,
  loadStructuredOutputConfig,
  readEnvSettings,
} from "./config.ts";

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

test("readEnvSettings maps structured output environment overrides", () => {
  process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE = " /tmp/schema.json ";
  process.env.PI_STRUCTURED_OUTPUT_TERMINATE = "0";
  const warnings: string[] = [];

  assert.deepEqual(readEnvSettings(process.env, warnings), {
    schemaFile: "/tmp/schema.json",
    terminate: false,
  });
  assert.deepEqual(warnings, []);
});

test("readEnvSettings warns on invalid boolean terminate", () => {
  process.env.PI_STRUCTURED_OUTPUT_TERMINATE = "sometimes";
  const warnings: string[] = [];

  assert.deepEqual(readEnvSettings(process.env, warnings), {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /PI_STRUCTURED_OUTPUT_TERMINATE/);
});

test("loadStructuredOutputConfig defaults to no-op config", async () => {
  delete process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE;
  delete process.env.PI_STRUCTURED_OUTPUT_TERMINATE;

  const root = join(
    tmpdir(),
    `structured-output-default-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    assert.deepEqual(
      await loadStructuredOutputConfig(cwd),
      DEFAULT_STRUCTURED_OUTPUT_CONFIG,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadStructuredOutputConfig merges global, project, and env settings", async () => {
  delete process.env.PI_STRUCTURED_OUTPUT_SCHEMA_FILE;
  delete process.env.PI_STRUCTURED_OUTPUT_TERMINATE;

  const root = join(
    tmpdir(),
    `structured-output-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        "extension:structured-output": {
          schemaFile: "/global/schema.json",
          terminate: false,
        },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "extension:structured-output": {
          schemaFile: "/project/schema.json",
        },
      }),
    );
    process.env.PI_STRUCTURED_OUTPUT_TERMINATE = "1";

    assert.deepEqual(await loadStructuredOutputConfig(cwd), {
      schemaFile: "/project/schema.json",
      terminate: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
