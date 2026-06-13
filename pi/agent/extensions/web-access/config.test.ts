import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadWebAccessConfig, readEnvSettings } from "./config.ts";

const ENV_NAMES = [
  "TAVILY_API_KEY",
  "JINA_API_KEY",
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

test("readEnvSettings maps web access environment overrides", () => {
  process.env.TAVILY_API_KEY = " tavily-token ";
  process.env.JINA_API_KEY = " jina-token ";

  assert.deepEqual(readEnvSettings(), {
    tavilyApiKey: "tavily-token",
    jinaApiKey: "jina-token",
  });
});

test("loadWebAccessConfig surfaces invalid settings warnings", async () => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.JINA_API_KEY;

  const root = join(
    tmpdir(),
    `web-access-config-warning-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    await writeFile(join(agentDir, "settings.json"), "{ invalid");
    const warnings: string[] = [];

    assert.deepEqual(await loadWebAccessConfig(cwd, warnings), {
      tavilyApiKey: undefined,
      jinaApiKey: undefined,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /Ignoring invalid JSON settings file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadWebAccessConfig merges global, project, and env settings", async () => {
  delete process.env.TAVILY_API_KEY;
  delete process.env.JINA_API_KEY;

  const root = join(
    tmpdir(),
    `web-access-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
        "extension:web-access": {
          tavilyApiKey: "global-tavily",
          jinaApiKey: "global-jina",
        },
      }),
    );
    await writeFile(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify({
        "extension:web-access": {
          tavilyApiKey: "project-tavily",
        },
      }),
    );
    process.env.JINA_API_KEY = "env-jina";

    assert.deepEqual(await loadWebAccessConfig(cwd), {
      tavilyApiKey: "project-tavily",
      jinaApiKey: "env-jina",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
