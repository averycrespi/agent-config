import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLoopConfig } from "./config.ts";

test("parseLoopConfig applies defaults and environment overrides", () => {
  const warnings: string[] = [];
  const config = parseLoopConfig({
    settings: {
      showWidget: false,
      defaultMaxContinuations: 4,
      hardMaxContinuations: 50,
    },
    env: {
      LOOP_SHOW_WIDGET: "true",
      LOOP_DEFAULT_MAX_ACTIVE_MINUTES: "30",
      LOOP_HARD_MAX_ACTIVE_MINUTES: "240",
      LOOP_DEFAULT_DELAY_SECONDS: "15",
      LOOP_HARD_MAX_DELAY_SECONDS: "600",
      LOOP_MESSAGE_MAX_CHARS: "2000",
      LOOP_REASON_MAX_CHARS: "500",
    },
    warnings,
  });

  assert.deepEqual(config, {
    showWidget: true,
    defaultMaxContinuations: 4,
    defaultMaxActiveMinutes: 30,
    hardMaxContinuations: 50,
    hardMaxActiveMinutes: 240,
    defaultDelaySeconds: 15,
    hardMaxDelaySeconds: 600,
    messageMaxChars: 2000,
    reasonMaxChars: 500,
  });
  assert.deepEqual(warnings, []);
});

test("parseLoopConfig repairs defaults that exceed hard ceilings", () => {
  const warnings: string[] = [];
  const config = parseLoopConfig({
    settings: {
      defaultMaxContinuations: 20,
      hardMaxContinuations: 10,
      defaultMaxActiveMinutes: 90,
      hardMaxActiveMinutes: 60,
      defaultDelaySeconds: 90,
      hardMaxDelaySeconds: 30,
    },
    env: {},
    warnings,
  });

  assert.equal(config.defaultMaxContinuations, 10);
  assert.equal(config.defaultMaxActiveMinutes, 60);
  assert.equal(config.defaultDelaySeconds, 30);
  assert.match(warnings.join("\n"), /defaultMaxContinuations/);
  assert.match(warnings.join("\n"), /defaultMaxActiveMinutes/);
  assert.match(warnings.join("\n"), /defaultDelaySeconds/);
});

test("parseLoopConfig warns and falls back for invalid values", () => {
  const warnings: string[] = [];
  const config = parseLoopConfig({
    settings: {
      hardMaxContinuations: 0,
      hardMaxDelaySeconds: Number.MAX_SAFE_INTEGER,
    },
    env: {
      LOOP_SHOW_WIDGET: "maybe",
      LOOP_MESSAGE_MAX_CHARS: "never",
    },
    warnings,
  });

  assert.equal(config.showWidget, true);
  assert.equal(config.hardMaxContinuations, 100);
  assert.equal(config.defaultDelaySeconds, 0);
  assert.equal(config.hardMaxDelaySeconds, 2_147_483);
  assert.equal(config.messageMaxChars, 4000);
  assert.match(warnings.join("\n"), /hardMaxContinuations/);
  assert.match(warnings.join("\n"), /hardMaxDelaySeconds/);
  assert.match(warnings.join("\n"), /LOOP_SHOW_WIDGET/);
  assert.match(warnings.join("\n"), /messageMaxChars/);
});
