import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMcpBrokerConfig, readEnvSettings } from "./config.ts";

const ENV_NAMES = [
  "MCP_BROKER_ENDPOINT",
  "MCP_BROKER_AUTH_TOKEN",
  "MCP_BROKER_READONLY",
  "PI_CODING_AGENT_DIR",
] as const;

const savedEnv = new Map<string, string | undefined>();
for (const name of ENV_NAMES) savedEnv.set(name, process.env[name]);

afterEach(async () => {
  for (const name of ENV_NAMES) {
    const value = savedEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("readEnvSettings maps broker environment overrides", () => {
  process.env.MCP_BROKER_ENDPOINT = " https://broker.example.com ";
  process.env.MCP_BROKER_AUTH_TOKEN = " token ";
  process.env.MCP_BROKER_READONLY = "1";

  assert.deepEqual(readEnvSettings(), {
    endpoint: "https://broker.example.com",
    authToken: "token",
    readOnly: true,
  });
});

test("readEnvSettings ignores invalid readonly environment values", () => {
  delete process.env.MCP_BROKER_ENDPOINT;
  delete process.env.MCP_BROKER_AUTH_TOKEN;
  process.env.MCP_BROKER_READONLY = "sometimes";

  assert.deepEqual(readEnvSettings(), {});
});

test("loadMcpBrokerConfig surfaces invalid settings warnings", async () => {
  delete process.env.MCP_BROKER_ENDPOINT;
  delete process.env.MCP_BROKER_AUTH_TOKEN;
  delete process.env.MCP_BROKER_READONLY;

  const root = join(
    tmpdir(),
    `mcp-broker-config-warning-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    await writeFile(join(agentDir, "settings.json"), "{ invalid");
    const warnings: string[] = [];

    assert.deepEqual(await loadMcpBrokerConfig(cwd, warnings), {
      endpoint: undefined,
      authToken: undefined,
      readOnly: false,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Ignoring invalid JSON settings file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadMcpBrokerConfig merges global, project, and env settings", async () => {
  delete process.env.MCP_BROKER_ENDPOINT;
  delete process.env.MCP_BROKER_AUTH_TOKEN;
  delete process.env.MCP_BROKER_READONLY;

  const root = join(
    tmpdir(),
    `mcp-broker-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
        "extension:mcp-broker": {
          endpoint: "https://global.example.com",
          authToken: "global-token",
          readOnly: false,
        },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "extension:mcp-broker": {
          endpoint: "https://project.example.com",
          readOnly: true,
        },
      }),
    );
    process.env.MCP_BROKER_AUTH_TOKEN = "env-token";
    process.env.MCP_BROKER_READONLY = "0";

    assert.deepEqual(await loadMcpBrokerConfig(cwd), {
      endpoint: "https://project.example.com",
      authToken: "env-token",
      readOnly: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
