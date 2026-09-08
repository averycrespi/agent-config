import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  parseConfig,
  validateConfig,
  loadGatewayConfig,
} from "./config.ts";
import { fixture, TEST_BEARER } from "./fixture.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("configuration defaults, environment precedence, booleans, and finite deadlines", () => {
  assert.deepEqual(parseConfig({}, {}), DEFAULT_CONFIG);
  const settings = {
    endpoint: "https://example.com/mcp",
    credentialFile: "/safe/agent",
    readOnly: true,
    callTimeoutMs: 5000,
  };
  for (const value of ["0", "false"])
    assert.equal(
      parseConfig(settings, { MCP_GATEWAY_READONLY: value }).readOnly,
      false,
    );
  for (const value of ["1", "true", "invalid"])
    assert.equal(
      parseConfig({}, { MCP_GATEWAY_READONLY: value }).readOnly,
      true,
    );
  assert.equal(
    parseConfig(settings, {
      MCP_GATEWAY_ENDPOINT: "https://other.example.com/mcp",
    }).endpoint,
    "https://other.example.com/mcp",
  );
  assert.equal(
    parseConfig(settings, { MCP_GATEWAY_ENDPOINT: "" }).endpoint,
    "",
  );
  for (const timeout of ["Infinity", "0", "-1", "300001"])
    assert.equal(
      parseConfig(settings, { MCP_GATEWAY_CALL_TIMEOUT_MS: timeout })
        .callTimeoutMs,
      65000,
    );
  assert.equal(
    parseConfig({}, { MCP_GATEWAY_DISCOVERY_TIMEOUT_MS: "42" })
      .discoveryTimeoutMs,
    42,
  );
  assert.equal(
    (parseConfig({ agentToken: TEST_BEARER }, {}) as any).agentToken,
    undefined,
  );
});

test("unsafe endpoint and credential path configurations are rejected without echoing input", () => {
  const config = {
    ...DEFAULT_CONFIG,
    endpoint: "http://127.0.0.1:8210/mcp",
    credentialFile: "/safe/agent",
  };
  assert.equal(validateConfig(config), config.endpoint);
  assert.equal(
    validateConfig({ ...config, endpoint: "https://gateway.example.com/mcp" }),
    "https://gateway.example.com/mcp",
  );
  for (const endpoint of [
    "http://example.com/mcp",
    "http://localhost/mcp",
    "file:///mcp",
    `https://${TEST_BEARER}@example.com/mcp`,
    `https://example.com/mcp?token=${TEST_BEARER}`,
    "https://example.com/mcp#fragment",
    "https://example.com/admin",
  ]) {
    assert.throws(
      () => validateConfig({ ...config, endpoint }),
      (error: Error) => !error.message.includes(TEST_BEARER),
    );
  }
  for (const credentialFile of [
    "relative/file",
    TEST_BEARER,
    `/safe/${TEST_BEARER}`,
    "/safe/\nfile",
  ])
    assert.throws(() => validateConfig({ ...config, credentialFile }));
});

test("project settings cannot redirect the credential; global parse errors and invalid config do not expose secrets", async (t) => {
  const f = await fixture(t);
  const env = { ...process.env };
  t.after(() => {
    process.env = env;
  });
  const agentDir = join(f.dir, "agent");
  await mkdir(agentDir);
  await mkdir(join(f.dir, ".pi"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  for (const key of Object.keys(process.env))
    if (key.startsWith("MCP_GATEWAY_")) delete process.env[key];
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ "extension:mcp-gateway": f.config }),
  );
  await writeFile(
    join(f.dir, ".pi/settings.json"),
    JSON.stringify({
      "extension:mcp-gateway": {
        endpoint: "https://untrusted.example.com/mcp",
        credentialFile: "/other",
      },
    }),
  );
  assert.equal((await loadGatewayConfig(f.dir)).endpoint, f.config.endpoint);
  await writeFile(join(agentDir, "settings.json"), `{ broken ${TEST_BEARER}`);
  const warnings: string[] = [];
  const parsed = await loadGatewayConfig(f.dir, warnings);
  assert.ok(!JSON.stringify({ parsed, warnings }).includes(TEST_BEARER));
  process.env.MCP_GATEWAY_ENDPOINT = `https://${TEST_BEARER}@example.com/mcp`;
  process.env.MCP_GATEWAY_CREDENTIAL_FILE = f.credentialFile;
  assert.ok(
    !JSON.stringify(await loadGatewayConfig(f.dir, warnings)).includes(
      TEST_BEARER,
    ),
  );
});
