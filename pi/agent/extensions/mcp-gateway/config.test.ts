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
    agentToken: "ignored-settings-token",
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

test("tokens come only from the environment, never settings or legacy file configuration", () => {
  const settings = {
    endpoint: "https://example.com/mcp",
    agentToken: TEST_BEARER,
    credentialFile: "/unused",
  };
  assert.equal(
    parseConfig(settings, { MCP_GATEWAY_CREDENTIAL_FILE: "/unused" })
      .agentToken,
    undefined,
  );
  assert.equal(
    parseConfig(settings, { MCP_GATEWAY_AGENT_TOKEN: ` ${TEST_BEARER} ` })
      .agentToken,
    TEST_BEARER,
  );
  assert.equal(
    parseConfig(settings, { MCP_GATEWAY_AGENT_TOKEN: "" }).agentToken,
    "",
  );
  assert.equal("credentialFile" in parseConfig(settings, {}), false);
  assert.throws(
    () =>
      validateConfig(
        parseConfig(settings, { MCP_GATEWAY_CREDENTIAL_FILE: "/unused" }),
      ),
    /MCP_GATEWAY_AGENT_TOKEN/,
  );
});

test("explicit trusted HTTP forwarding hostnames retain endpoint and credential configuration", async (t) => {
  const f = await fixture(t);
  const previous = { ...process.env };
  t.after(() => {
    process.env = previous;
  });
  process.env.PI_CODING_AGENT_DIR = f.dir;
  process.env.MCP_GATEWAY_ENDPOINT = "http://host.lima.internal:8211/mcp";
  process.env.MCP_GATEWAY_AGENT_TOKEN = TEST_BEARER;
  const warnings: string[] = [];
  const loaded = await loadGatewayConfig(f.dir, warnings);
  assert.equal(loaded.endpoint, "http://host.lima.internal:8211/mcp");
  assert.equal(loaded.agentToken, TEST_BEARER);
  assert.deepEqual(warnings, []);
  for (const hostname of [
    "localhost",
    "gateway.example.com",
    "HOST.LIMA.INTERNAL",
    "xn--bcher-kva.example",
  ]) {
    assert.equal(
      validateConfig({ ...f.config, endpoint: `http://${hostname}:8211/mcp` }),
      `http://${hostname.toLowerCase()}:8211/mcp`,
    );
  }
});

test("unsafe endpoint and token configurations are rejected without echoing input", () => {
  const config = {
    ...DEFAULT_CONFIG,
    endpoint: "http://127.0.0.1:8210/mcp",
    agentToken: TEST_BEARER,
  };
  assert.equal(validateConfig(config), config.endpoint);
  assert.equal(
    validateConfig({ ...config, endpoint: "https://gateway.example.com/mcp" }),
    "https://gateway.example.com/mcp",
  );
  for (const endpoint of [
    "http://192.0.2.1:8211/mcp",
    "http://[::1]:8211/mcp",
    "http://bad_host.example:8211/mcp",
    "http://host.example.:8211/mcp",
    "http://-bad.example:8211/mcp",
    "http://bad-.example:8211/mcp",
    "http://bad..example:8211/mcp",
    `http://${"a".repeat(64)}.example:8211/mcp`,
    `http://${Array(5).fill("a".repeat(60)).join(".")}:8211/mcp`,
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
  for (const agentToken of [
    undefined,
    "",
    "mgw_admin_secret",
    `${TEST_BEARER}\nheader`,
    "invalid",
  ]) {
    assert.throws(
      () => validateConfig({ ...config, agentToken }),
      (error: Error) => !error.message.includes(TEST_BEARER),
    );
  }
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
        agentToken: "untrusted-project-token",
      },
    }),
  );
  process.env.MCP_GATEWAY_AGENT_TOKEN = TEST_BEARER;
  assert.equal((await loadGatewayConfig(f.dir)).endpoint, f.config.endpoint);
  await writeFile(join(agentDir, "settings.json"), `{ broken ${TEST_BEARER}`);
  const warnings: string[] = [];
  const parsed = await loadGatewayConfig(f.dir, warnings);
  assert.ok(!JSON.stringify({ parsed, warnings }).includes(TEST_BEARER));
  process.env.MCP_GATEWAY_ENDPOINT = `https://${TEST_BEARER}@example.com/mcp`;
  process.env.MCP_GATEWAY_AGENT_TOKEN = TEST_BEARER;
  assert.ok(
    !JSON.stringify(await loadGatewayConfig(f.dir, warnings)).includes(
      TEST_BEARER,
    ),
  );
});
