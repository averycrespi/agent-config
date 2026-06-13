import assert from "node:assert/strict";
import test from "node:test";

import {
  formatConfigForDisplay,
  maskConfigValue,
  mergeExtensionConfig,
  parseBooleanEnv,
  readExtensionSettings,
  registerConfigCommand,
} from "./config.ts";

test("readExtensionSettings reads extension-scoped top-level object", () => {
  assert.deepEqual(
    readExtensionSettings(
      {
        model: "x",
        "extension:example-extension": { apiUrl: "https://example.com" },
      },
      "example-extension",
    ),
    { apiUrl: "https://example.com" },
  );
});

test("readExtensionSettings ignores missing or non-object config", () => {
  assert.deepEqual(readExtensionSettings({}, "missing"), {});
  assert.deepEqual(readExtensionSettings({ "extension:x": null }, "x"), {});
  assert.deepEqual(readExtensionSettings({ "extension:x": "bad" }, "x"), {});
});

test("mergeExtensionConfig applies defaults, global, project, env in order", () => {
  const result = mergeExtensionConfig({
    defaults: { enabled: true, apiUrl: "default", bankId: "a" },
    globalSettings: { enabled: false, apiUrl: "global" },
    projectSettings: { apiUrl: "project" },
    envSettings: { bankId: "env" },
  });

  assert.deepEqual(result, {
    enabled: false,
    apiUrl: "project",
    bankId: "env",
  });
});

test("parseBooleanEnv accepts common true and false values", () => {
  assert.equal(parseBooleanEnv("true"), true);
  assert.equal(parseBooleanEnv("1"), true);
  assert.equal(parseBooleanEnv("yes"), true);
  assert.equal(parseBooleanEnv("false"), false);
  assert.equal(parseBooleanEnv("0"), false);
  assert.equal(parseBooleanEnv("no"), false);
  assert.equal(parseBooleanEnv(""), undefined);
});

test("parseBooleanEnv reports invalid values without throwing", () => {
  const warnings: string[] = [];

  assert.equal(
    parseBooleanEnv("sometimes", "EXAMPLE_ENABLED", warnings),
    undefined,
  );
  assert.deepEqual(warnings, [
    "Ignoring invalid boolean env EXAMPLE_ENABLED=sometimes",
  ]);
});

test("maskConfigValue masks configured sensitive fields and preserves unset values", () => {
  const result = maskConfigValue(
    {
      endpoint: "https://broker.example.com",
      authToken: "secret-token",
      nested: { authToken: undefined },
    },
    ["authToken"],
  );

  assert.deepEqual(result, {
    endpoint: "https://broker.example.com",
    authToken: "********",
    nested: { authToken: "(unset)" },
  });
});

test("formatConfigForDisplay emits stable masked JSON", () => {
  const output = formatConfigForDisplay(
    "example",
    { enabled: true, apiKey: "secret", optional: undefined },
    { sensitiveFields: ["apiKey"] },
  );

  assert.match(output, /^example effective config:/);
  assert.match(output, /"enabled": true/);
  assert.match(output, /"apiKey": "\*\*\*\*\*\*\*\*"/);
  assert.match(output, /"optional": "\(unset\)"/);
  assert.doesNotMatch(output, /secret/);
});

test("registerConfigCommand displays config loader warnings", async () => {
  const commands = new Map<string, any>();
  const notifications: Array<{ message: string; level: string }> = [];
  const pi = {
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  };

  registerConfigCommand(pi, {
    extensionName: "example",
    loadConfig: async (_cwd, warnings = []) => {
      warnings.push(
        "Ignoring invalid JSON settings file /repo/.pi/settings.json",
      );
      return { enabled: true };
    },
  });

  await commands.get("example-config").handler("", {
    cwd: "/repo",
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications[0].level, "warning");
  assert.match(notifications[0].message, /"enabled": true/);
  assert.match(notifications[0].message, /Ignoring invalid JSON settings file/);
});

test("registerConfigCommand registers and displays loaded effective config", async () => {
  const commands = new Map<string, any>();
  const notifications: Array<{ message: string; level: string }> = [];
  const pi = {
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
  };

  registerConfigCommand(pi, {
    extensionName: "example",
    loadConfig: async (cwd) => ({ cwd, apiKey: "secret" }),
    sensitiveFields: ["apiKey"],
  });

  await commands.get("example-config").handler("", {
    cwd: "/repo",
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  });

  assert.equal(notifications[0].level, "info");
  assert.match(notifications[0].message, /"cwd": "\/repo"/);
  assert.doesNotMatch(notifications[0].message, /secret/);
});
