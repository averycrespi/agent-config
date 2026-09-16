import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  describeScriptProviders,
  registerScriptProvider,
  type ScriptProvider,
} from "./api.ts";
import { collectProviders } from "./provider.ts";
import { parseConfig } from "./config.ts";
import { fixture, echo, limits } from "./fixture.ts";

test("registration is atomic, conflict-safe, independent of module cache and removable", async (t) => {
  const f = await fixture(t);
  for (const provider of [
    { namespace: "process", methods: { echo }, available: () => true },
    {
      namespace: "fixture",
      methods: {
        echo,
        invalid: {
          ...echo,
          inputSchema: { type: "array", $ref: "https://example.com/schema" },
        },
      },
      available: () => true,
    },
    {
      namespace: "fixture",
      methods: {
        echo,
        invalid: {
          ...echo,
          inputSchema: { type: "array", unknownKeyword: true },
        },
      },
      available: () => true,
    },
    {
      namespace: "fixture",
      methods: {
        echo,
        invalid: { ...echo, inputSchema: { type: "array", $async: true } },
      },
      available: () => true,
    },
  ] as ScriptProvider[]) {
    assert.throws(() => registerScriptProvider(f.pi, provider));
    assert.equal(collectProviders(f.pi).length, 0);
  }
  const original = structuredClone(echo.inputSchema);
  const method = { ...echo, inputSchema: original };
  const remove = registerScriptProvider(f.pi, {
    namespace: "fixture",
    methods: { echo: method },
    available: () => true,
  });
  original.type = "string";
  assert.throws(
    () =>
      registerScriptProvider(f.pi, {
        namespace: "fixture",
        methods: { echo },
        available: () => false,
      }),
    /provider_conflict/,
  );
  assert.equal(collectProviders(f.pi).length, 1);
  const schemas = await describeScriptProviders(f.pi, f.dir, []);
  assert.equal(schemas[0].methods[0].inputSchema.type, "array");
  schemas[0].methods[0].inputSchema.type = "string";
  assert.equal(
    (await f.run("return await fixture.echo(4);", { providers: ["fixture"] }))
      .json,
    "4",
  );
  remove();
  remove();
  assert.equal(collectProviders(f.pi).length, 0);
});

test("declared public errors survive catches, are snapshotted, and reject undeclared codes", async (t) => {
  const codes = ["known_failure"];
  let code = "known_failure";
  const f = await fixture(t, {
    echo: {
      ...echo,
      errorCodes: codes,
      handler: async () => ({ value: null, error: code }),
    },
  });
  codes.push("private_code");
  const r = await f.run(
    "try { await fixture.echo(1); } catch(e) { return e.code; }",
  );
  assert.equal(r.json, '"known_failure"');
  assert.equal(r.status, "failed");
  assert.equal(r.traces[0].code, "known_failure");
  assert.equal(r.outcomeUnknown, false);
  code = "private_code";
  const bad = await f.run(
    "try { await fixture.echo(1); } catch {} return null;",
  );
  assert.equal(bad.traces[0].code, "provider_error");
  assert.equal(bad.outcomeUnknown, true);
  assert.doesNotMatch(JSON.stringify(bad), /private_code/);
  for (const invalid of [
    ["bad\\ncode"],
    ["duplicate", "duplicate"],
    Array(65).fill("code"),
    Array(1),
  ]) {
    assert.throws(() =>
      registerScriptProvider(f.pi, {
        namespace: "invalid",
        available: () => true,
        methods: { echo: { ...echo, errorCodes: invalid } },
      }),
    );
    assert.equal(collectProviders(f.pi).length, 1);
  }
});

test("selection is explicit and intersects host policy and caller ceiling", async (t) => {
  const f = await fixture(t, { echo });
  assert.equal(
    (await f.run("return null;", { providers: undefined as any })).code,
    "invalid_selection",
  );
  assert.equal(
    (await f.run("return await fixture.echo(1);", { providers: [] })).code,
    "script_error",
  );
  assert.equal(
    (await f.run("return null;", { capabilityCeiling: [] })).code,
    "capability_denied",
  );
  assert.equal(
    (await f.run("return null;", { providers: ["missing"] })).code,
    "capability_denied",
  );
  await f.config({ allowedProviders: ["fixture", "missing"] });
  assert.equal(
    (await f.run("return null;", { providers: ["missing"] })).code,
    "capability_unavailable",
  );
  await f.config({ allowedProviders: [] });
  assert.equal((await f.run("return null;")).code, "capability_denied");
  assert.equal(
    (await f.run("return null;", { providers: [] })).status,
    "success",
  );
  assert.deepEqual(await describeScriptProviders(f.pi, f.dir, []), []);
  await f.config({ allowedProviders: ["fixture"] });
  f.unavailable();
  assert.equal((await f.run("return null;")).code, "capability_unavailable");
});

test("availability is checked again before each call", async (t) => {
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async () => {
        f.unavailable();
        return { value: 1 };
      },
    },
  });
  const r = await f.run(
    "await fixture.echo(1); try { await fixture.echo(2); } catch {} return null;",
  );
  assert.equal(r.code, "nested_call_failed");
  assert.deepEqual(
    r.traces.map((t) => t.dispatched),
    [true, false],
  );
  assert.equal(r.traces[1].code, "capability_unavailable");
});

test("host limits tighten caller limits; invalid policy never falls back to permissive defaults", async (t) => {
  const f = await fixture(t, { echo });
  await f.config({ allowedProviders: ["fixture"], maxCalls: 1 });
  assert.equal(
    (await f.run("await fixture.echo(1); await fixture.echo(2); return null;"))
      .code,
    "call_limit",
  );
  assert.equal(
    (await f.run("return null;", { limits: { ...limits, maxCalls: 0 } })).code,
    "invalid_config",
  );
  assert.equal(
    (await f.run("return null;", { deadlineMs: Date.now() - 1 })).status,
    "timeout",
  );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await f.run("return null;", { signal: controller.signal })).status,
    "cancelled",
  );
  for (const setting of [
    null,
    [],
    { allowedProviders: null },
    { allowedProviders: "fixture" },
    { maxCalls: null },
  ]) {
    await f.config(setting);
    assert.equal(
      (await f.run("return null;")).code,
      "invalid_config",
      JSON.stringify(setting),
    );
  }
  await writeFile(join(f.dir, "settings.json"), "{");
  assert.equal((await f.run("return null;")).code, "invalid_config");
  assert.equal(
    parseConfig({}, { SCRIPT_ALLOWED_PROVIDERS: '["fixture"]' }).valid,
    true,
  );
  assert.equal(parseConfig({}, { SCRIPT_ALLOWED_PROVIDERS: "*" }).valid, false);
});
