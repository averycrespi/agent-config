import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../script/fixture.ts";
import {
  DEFAULT_CONFIG,
  MAX_DURATION_MS,
  loadMonitorConfig,
  parseConfig,
  parseGlobalConfig,
  LEGACY_WARNING,
} from "./config.ts";
import { registration } from "./contract.ts";
import { parameters } from "./tool.ts";

const input = {
  name: "limits",
  message: "Inspect",
  providers: [],
  max_wakes: 1,
  cycle_timeout_ms: 1_680_000,
  lifetime_ms: 86_400_000,
  delay_ms: 1_680_000,
};
test("default ceilings are 28 minutes and 24 hours; job arguments stay required", () => {
  const config = parseConfig({}, {});
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(config.maxCycleTimeoutMs, 1_680_000);
  assert.equal(registration(input).cycleMs, 1_680_000);
  const schema = parameters(config).properties as Record<
    string,
    { maximum?: number }
  >;
  for (const field of ["cycle_timeout_ms", "interval_ms", "delay_ms"] as const)
    assert.equal(schema[field].maximum, 1_680_000);
  for (const key of ["cycle_timeout_ms", "lifetime_ms", "max_wakes"]) {
    const raw: Record<string, unknown> = { ...input };
    delete raw[key];
    assert.throws(() => registration(raw), new RegExp(key));
  }
  assert.throws(
    () => registration({ ...input, cycle_timeout_ms: 1_680_001 }),
    /1680000/,
  );
  assert.throws(
    () => registration({ ...input, lifetime_ms: 86_400_001 }),
    /86400000/,
  );
});
test("overrides above old ceilings align schema, admission and timer modes", () => {
  const config = parseConfig(
    { maxCycleTimeoutMs: 3_600_000, maxLifetimeMs: 172_800_000 },
    {},
  );
  const schema = parameters(config).properties as Record<
    string,
    { maximum?: number }
  >;
  for (const field of ["cycle_timeout_ms", "interval_ms", "delay_ms"] as const)
    assert.equal(schema[field].maximum, 3_600_000);
  assert.equal(schema.lifetime_ms.maximum, 172_800_000);
  const raw = {
    ...input,
    cycle_timeout_ms: 3_600_000,
    lifetime_ms: 172_800_000,
    delay_ms: 3_600_000,
  };
  assert.equal(registration(raw, config).lifetimeMs, 172_800_000);
  const { delay_ms: _delay, ...poll } = raw;
  assert.equal(
    registration(
      { ...poll, interval_ms: 3_600_000, source: "return null;" },
      config,
    ).intervalMs,
    3_600_000,
  );
  for (const field of ["cycle_timeout_ms", "delay_ms", "lifetime_ms"])
    assert.throws(
      () =>
        registration(
          { ...raw, [field]: (raw[field as keyof typeof raw] as number) + 1 },
          config,
        ),
      new RegExp(field),
    );
  assert.throws(
    () =>
      registration(
        { ...poll, interval_ms: 3_600_001, source: "return null;" },
        config,
      ),
    /interval_ms/,
  );
  const strict = parseConfig(
    { maxCycleTimeoutMs: 1000, maxLifetimeMs: 1000 },
    {},
  );
  assert.throws(() => registration(input, strict), /1000/);
});
test("unknown policy fields fail closed even with valid environment overrides", () => {
  for (const settings of [
    { maxLifetimMs: 1000 },
    { maxCycleTimeoutMs: 1000, unsupported: 1000 },
    { valid: true },
    JSON.parse('{"__proto__": {"maxLifetimeMs": 1000}}'),
  ]) {
    const config = parseConfig(settings, {
      MONITOR_MAX_CYCLE_TIMEOUT_MS: "3600000",
      MONITOR_MAX_LIFETIME_MS: "172800000",
    });
    assert.equal(config.valid, false);
    assert.throws(() => registration(input, config), /disabled/);
  }
});

test("invalid numeric policy disables admission; environment has precedence", () => {
  for (const value of [
    null,
    true,
    false,
    [],
    {},
    "",
    " ",
    "NaN",
    "Infinity",
    "1e6",
    -1,
    0,
    999,
    1000.5,
    NaN,
    Infinity,
    MAX_DURATION_MS + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    for (const key of ["maxCycleTimeoutMs", "maxLifetimeMs"]) {
      const config = parseConfig({ [key]: value }, {});
      assert.equal(config.valid, false, `${key}: ${String(value)}`);
      assert.throws(() => registration(input, config), /disabled/);
    }
    for (const key of [
      "MONITOR_MAX_CYCLE_TIMEOUT_MS",
      "MONITOR_MAX_LIFETIME_MS",
    ])
      assert.equal(parseConfig({}, { [key]: String(value) }).valid, false);
  }
  assert.deepEqual(
    parseConfig(
      { maxCycleTimeoutMs: null, maxLifetimeMs: 1000 },
      {
        MONITOR_MAX_CYCLE_TIMEOUT_MS: "3600000",
        MONITOR_MAX_LIFETIME_MS: "172800000",
      },
    ),
    { maxCycleTimeoutMs: 3_600_000, maxLifetimeMs: 172_800_000, valid: true },
  );
  const max = parseConfig(
    { maxCycleTimeoutMs: MAX_DURATION_MS, maxLifetimeMs: MAX_DURATION_MS },
    {},
  );
  assert.equal(max.valid, true);
  assert.equal(
    registration(
      {
        ...input,
        cycle_timeout_ms: MAX_DURATION_MS,
        lifetime_ms: MAX_DURATION_MS,
        delay_ms: MAX_DURATION_MS,
      },
      max,
    ).cycleMs,
    MAX_DURATION_MS,
  );
  assert.ok(MAX_DURATION_MS + 2000 <= 2_147_483_647);
});
test("legacy settings and environment preserve limits with visible warnings", () => {
  for (const [root, env] of [
    [
      {
        "extension:background": {
          maxCycleTimeoutMs: 1000,
          maxLifetimeMs: 2000,
        },
      },
      {},
    ],
    [
      {},
      {
        BACKGROUND_MAX_CYCLE_TIMEOUT_MS: "1000",
        BACKGROUND_MAX_LIFETIME_MS: "2000",
      },
    ],
    [
      {
        "extension:background": { maxCycleTimeoutMs: 1000 },
        "extension:monitor": { maxLifetimeMs: 2000 },
      },
      {},
    ],
    [
      {
        "extension:background": {
          maxCycleTimeoutMs: "1000",
          maxLifetimeMs: 2000,
        },
        "extension:monitor": { maxCycleTimeoutMs: 1000 },
      },
      { MONITOR_MAX_LIFETIME_MS: "2000", BACKGROUND_MAX_LIFETIME_MS: "2000" },
    ],
  ] as const) {
    const warnings: string[] = [];
    assert.deepEqual(parseGlobalConfig(root, env, warnings), {
      maxCycleTimeoutMs: 1000,
      maxLifetimeMs: 2000,
      valid: true,
    });
    assert.deepEqual(warnings, [LEGACY_WARNING]);
  }
});

test("conflicting aliases and malformed legacy policy fail closed without leaking values", () => {
  for (const [root, env] of [
    [
      {
        "extension:background": { maxLifetimeMs: 1000 },
        "extension:monitor": { maxLifetimeMs: 2000 },
      },
      {},
    ],
    [
      {
        "extension:background": { maxLifetimeMs: 1000 },
        "extension:monitor": { maxLifetimeMs: 2000 },
      },
      { MONITOR_MAX_LIFETIME_MS: "3000" },
    ],
    [
      {},
      { MONITOR_MAX_LIFETIME_MS: "2000", BACKGROUND_MAX_LIFETIME_MS: "1000" },
    ],
    [
      {},
      {
        MONITOR_MAX_LIFETIME_MS: "2000",
        BACKGROUND_MAX_LIFETIME_MS: "PRIVATE",
      },
    ],
    [{ "extension:background": null, "extension:monitor": {} }, {}],
    [
      {
        "extension:background": { unsupported: 1000 },
        "extension:monitor": {},
      },
      {},
    ],
    [{ "extension:background": { maxLifetimeMs: "PRIVATE" } }, {}],
  ] as const) {
    const warnings: string[] = [];
    const config = parseGlobalConfig(root, env, warnings);
    assert.equal(config.valid, false);
    assert.throws(() => registration(input, config), /disabled/);
    assert.deepEqual(warnings, [LEGACY_WARNING]);
    assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE/);
  }
});

test("global loader rejects malformed or unreadable settings, ignores project policy", async (t) => {
  const f = await fixture(t);
  delete process.env.MONITOR_MAX_CYCLE_TIMEOUT_MS;
  delete process.env.MONITOR_MAX_LIFETIME_MS;
  await mkdir(join(f.dir, ".pi"));
  await writeFile(
    join(f.dir, ".pi", "settings.json"),
    JSON.stringify({ "extension:monitor": { maxCycleTimeoutMs: 1000 } }),
  );
  const path = join(f.dir, "settings.json");
  for (const text of [
    "{",
    "null",
    "[]",
    '{"extension:monitor":null}',
    '{"extension:monitor":[]}',
    '{"extension:monitor":{"maxLifetimMs":1000}}',
  ]) {
    await writeFile(path, text);
    assert.equal((await loadMonitorConfig()).valid, false);
  }
  await writeFile(
    path,
    JSON.stringify({
      "extension:monitor": { maxCycleTimeoutMs: 3_600_000 },
    }),
  );
  assert.equal((await loadMonitorConfig()).maxCycleTimeoutMs, 3_600_000);
  process.env.MONITOR_MAX_CYCLE_TIMEOUT_MS = "7200000";
  assert.equal((await loadMonitorConfig()).maxCycleTimeoutMs, 7_200_000);
  delete process.env.MONITOR_MAX_CYCLE_TIMEOUT_MS;
  process.env.PI_CODING_AGENT_DIR = join(f.dir, "missing");
  assert.deepEqual(await loadMonitorConfig(), DEFAULT_CONFIG);
  await mkdir(join(f.dir, "unreadable", "settings.json"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = join(f.dir, "unreadable");
  assert.equal((await loadMonitorConfig()).valid, false);
});
