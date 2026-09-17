import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG, parseConfig, loadConfig } from "./config.ts";
import { harness } from "./test-support.ts";

test("default is opt-out; global settings merge with environment overrides", () => {
  assert.deepEqual(parseConfig({}, {}), DEFAULT_CONFIG);
  assert.equal(parseConfig({}, {}).idleMinutes, 29);
  assert.deepEqual(
    parseConfig(
      {
        "extension:idle-compaction": {
          enabled: true,
          idleMinutes: 5,
          contextPercent: 60,
        },
      },
      {
        IDLE_COMPACTION_ENABLED: "0",
        IDLE_COMPACTION_IDLE_MINUTES: "2.5",
        IDLE_COMPACTION_CONTEXT_PERCENT: "0",
      },
    ),
    { enabled: false, idleMinutes: 2.5, contextPercent: 0, valid: true },
  );
  for (const value of ["true", "1"])
    assert.equal(
      parseConfig({}, { IDLE_COMPACTION_ENABLED: value }).enabled,
      true,
    );
  for (const value of ["false", "0"])
    assert.equal(
      parseConfig({}, { IDLE_COMPACTION_ENABLED: value }).enabled,
      false,
    );
});

for (const settings of [
  null,
  [],
  { "extension:idle-compaction": "bad" },
  { "extension:idle-compaction": { enabled: "true" } },
  { "extension:idle-compaction": { enabled: true, idleMinutes: 0 } },
  { "extension:idle-compaction": { enabled: true, idleMinutes: 10081 } },
  { "extension:idle-compaction": { enabled: true, contextPercent: 101 } },
])
  test(`invalid settings disable instead of falling back ${JSON.stringify(settings)}`, () => {
    const warnings: string[] = [];
    const config = parseConfig(settings, {}, warnings);
    assert.equal(config.valid, false);
    assert.equal(config.enabled, false);
    assert.ok(warnings.length);
  });

for (const env of [
  { IDLE_COMPACTION_ENABLED: "\u001b[31msecret" },
  { IDLE_COMPACTION_ENABLED: "" },
  { IDLE_COMPACTION_IDLE_MINUTES: "NaN" },
  { IDLE_COMPACTION_IDLE_MINUTES: "-1" },
  { IDLE_COMPACTION_CONTEXT_PERCENT: "" },
  { IDLE_COMPACTION_CONTEXT_PERCENT: "Infinity" },
])
  test(`invalid environment fails closed ${JSON.stringify(env)}`, () => {
    const warnings: string[] = [];
    const config = parseConfig(
      { "extension:idle-compaction": { enabled: true } },
      env,
      warnings,
    );
    assert.equal(config.valid, false);
    assert.equal(config.enabled, false);
    assert.doesNotMatch(warnings.join("\n"), /secret|\u001b/);
  });

test("global JSON read errors disable automatic action without disclosing raw settings", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "idle-config-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(await loadConfig([], dir, {}), DEFAULT_CONFIG);
  await writeFile(join(dir, "settings.json"), '{"secret":"private"');
  const warnings: string[] = [];
  const config = await loadConfig(warnings, dir, {
    IDLE_COMPACTION_ENABLED: "1",
  });
  assert.equal(config.valid, false);
  assert.doesNotMatch(warnings.join("\n"), /private/);
});

test("inspection command displays loaded configuration and never mutates it", async () => {
  const h = harness();
  await h.start();
  await h.commands.get("idle-compaction-config").handler("", h.ctx);
  assert.match(h.notifications.at(-1)!, /"enabled": true/);
  assert.match(h.notifications.at(-1)!, /"idleMinutes": 1/);
  await h.command("disable");
  await h.commands.get("idle-compaction-config").handler("", h.ctx);
  assert.match(h.notifications.at(-1)!, /"enabled": true/);
});
