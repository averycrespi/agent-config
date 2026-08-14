import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMcpBrokerConfig, readEnvSettings } from "./config.ts";

const ENV_NAMES = [
  "MCP_BROKER_ENDPOINT",
  "MCP_BROKER_AGENT_TOKEN",
  "MCP_BROKER_AUTH_TOKEN",
  "MCP_BROKER_READONLY",
  "MCP_BROKER_APPROVAL_MODE",
  "MCP_BROKER_APPROVAL_TIMEOUT_MS",
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
  process.env.MCP_BROKER_AGENT_TOKEN = " token ";
  process.env.MCP_BROKER_READONLY = "1";
  process.env.MCP_BROKER_APPROVAL_MODE = "reject";
  process.env.MCP_BROKER_APPROVAL_TIMEOUT_MS = "30000";

  assert.deepEqual(readEnvSettings(), {
    endpoint: "https://broker.example.com",
    agentToken: "token",
    readOnly: true,
    approvalMode: "reject",
    approvalTimeoutMs: 30000,
  });
});

test("readEnvSettings accepts the deprecated auth token environment alias", () => {
  delete process.env.MCP_BROKER_AGENT_TOKEN;
  process.env.MCP_BROKER_AUTH_TOKEN = " legacy-token ";
  const warnings: string[] = [];

  assert.deepEqual(readEnvSettings(warnings), {
    agentToken: "legacy-token",
  });
  assert.deepEqual(warnings, [
    "MCP_BROKER_AUTH_TOKEN is deprecated; use MCP_BROKER_AGENT_TOKEN.",
  ]);
});

test("readEnvSettings prefers the agent token environment variable on conflict", () => {
  process.env.MCP_BROKER_AGENT_TOKEN = "agent-token";
  process.env.MCP_BROKER_AUTH_TOKEN = "legacy-token";
  const warnings: string[] = [];

  assert.deepEqual(readEnvSettings(warnings), {
    agentToken: "agent-token",
  });
  assert.deepEqual(warnings, [
    "Both MCP_BROKER_AGENT_TOKEN and deprecated MCP_BROKER_AUTH_TOKEN are set; using MCP_BROKER_AGENT_TOKEN.",
  ]);
});

test("readEnvSettings ignores invalid readonly, approval mode, and timeout environment values", () => {
  delete process.env.MCP_BROKER_ENDPOINT;
  delete process.env.MCP_BROKER_AGENT_TOKEN;
  delete process.env.MCP_BROKER_AUTH_TOKEN;
  process.env.MCP_BROKER_READONLY = "sometimes";
  process.env.MCP_BROKER_APPROVAL_MODE = "never";
  process.env.MCP_BROKER_APPROVAL_TIMEOUT_MS = "0";

  assert.deepEqual(readEnvSettings(), {});
});

test("loadMcpBrokerConfig surfaces invalid settings warnings", async () => {
  delete process.env.MCP_BROKER_ENDPOINT;
  delete process.env.MCP_BROKER_AGENT_TOKEN;
  delete process.env.MCP_BROKER_AUTH_TOKEN;
  delete process.env.MCP_BROKER_READONLY;
  delete process.env.MCP_BROKER_APPROVAL_MODE;
  delete process.env.MCP_BROKER_APPROVAL_TIMEOUT_MS;

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
      agentToken: undefined,
      readOnly: false,
      approvalMode: "wait",
      approvalTimeoutMs: 600000,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Ignoring invalid JSON settings file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadMcpBrokerConfig merges global, project, and env settings", async () => {
  delete process.env.MCP_BROKER_ENDPOINT;
  delete process.env.MCP_BROKER_AGENT_TOKEN;
  delete process.env.MCP_BROKER_AUTH_TOKEN;
  delete process.env.MCP_BROKER_READONLY;
  delete process.env.MCP_BROKER_APPROVAL_MODE;
  delete process.env.MCP_BROKER_APPROVAL_TIMEOUT_MS;

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
          agentToken: "global-token",
          readOnly: false,
          approvalMode: "wait",
          approvalTimeoutMs: 120000,
        },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "extension:mcp-broker": {
          endpoint: "https://project.example.com",
          readOnly: true,
          approvalMode: "reject",
          approvalTimeoutMs: 300000,
        },
      }),
    );
    process.env.MCP_BROKER_AGENT_TOKEN = "env-token";
    process.env.MCP_BROKER_READONLY = "0";
    process.env.MCP_BROKER_APPROVAL_MODE = "wait";
    process.env.MCP_BROKER_APPROVAL_TIMEOUT_MS = "450000";

    assert.deepEqual(await loadMcpBrokerConfig(cwd), {
      endpoint: "https://project.example.com",
      agentToken: "env-token",
      readOnly: false,
      approvalMode: "wait",
      approvalTimeoutMs: 450000,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadMcpBrokerConfig preserves precedence for deprecated settings aliases", async () => {
  delete process.env.MCP_BROKER_AGENT_TOKEN;
  delete process.env.MCP_BROKER_AUTH_TOKEN;

  const root = join(
    tmpdir(),
    `mcp-broker-legacy-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
          agentToken: "global-agent-token",
          authToken: "ignored-global-legacy-token",
        },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "extension:mcp-broker": { authToken: "project-legacy-token" },
      }),
    );
    const warnings: string[] = [];

    assert.equal(
      (await loadMcpBrokerConfig(cwd, warnings)).agentToken,
      "project-legacy-token",
    );
    assert.deepEqual(warnings, [
      "extension:mcp-broker defines both agentToken and deprecated authToken in global settings; using agentToken.",
      "extension:mcp-broker authToken in project settings is deprecated; use agentToken.",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
