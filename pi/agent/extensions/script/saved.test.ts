import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseDefinition,
  validateArguments,
  MAX_DEFINITION_BYTES,
} from "./definition.ts";
import { inventoryScripts, loadDefinition, _storeHooks } from "./store.ts";
import { definitionSource, savedFixture } from "./saved-fixture.ts";
import { echo, fixture } from "./fixture.ts";
import { parseConfig } from "./config.ts";
import { prepareScript } from "./api.ts";

test("literal metadata/schema/entry point validation never runs definitions", () => {
  const source = definitionSource("throw new Error('not executed');");
  assert.equal(parseDefinition(source).meta.name, "sample");
  const invalid = [
    source.replace(
      '"Example"',
      "(() => { throw new Error('host execution'); })()",
    ),
    source.replace('"name":"sample"', '"name":"sample","name":"other"'),
    source.replace("export async function", "export function"),
    source.replace("run()", "run(args)"),
    source + "\nthrow Error('host');",
    source.replace(
      "throw new Error('not executed');",
      "return await import('node:fs');",
    ),
    source.replace('"name":"sample",', '"name":"sample" '),
    definitionSource("return null;", {
      limits: { maxCalls: 129, maxConcurrency: 1, timeoutMs: 1000 },
    }),
    definitionSource("return null;", {
      limits: { maxCalls: 0, maxConcurrency: 1, timeoutMs: 1000 },
    }),
    ...[
      { type: "object", mystery: true },
      { type: "object", $async: true },
      { type: "object", $ref: "https://example.com/schema" },
      { type: "string" },
    ].map((args) => definitionSource("return null;", { args })),
  ];
  for (const value of invalid) assert.throws(() => parseDefinition(value));
  const d = parseDefinition(
    definitionSource("return args;", {
      args: {
        type: "object",
        properties: { n: { type: "integer" } },
        required: ["n"],
        additionalProperties: false,
      },
    }),
  );
  assert.equal(validateArguments(d, { n: 1 }), '{"n":1}');
  for (const args of [
    undefined,
    { n: "1" },
    { n: 1, extra: true },
    { n: NaN },
    {
      get n() {
        return assert.fail("getter executed");
      },
    },
    { n: "x".repeat(65536) },
  ])
    assert.throws(() => validateArguments(d, args));
});

test("store rejects unsafe entries, follows store symlink only, observes edits, bounds inventory", async (t) => {
  const f = await fixture(t);
  const store = join(f.dir, "scripts");
  await mkdir(store);
  await writeFile(join(store, "sample.js"), definitionSource());
  const original = await loadDefinition(store, "sample");
  await writeFile(join(store, "sample.js"), definitionSource("return null;"));
  assert.notEqual(
    (await loadDefinition(store, "sample")).digest,
    original.digest,
  );
  await symlink(store, join(f.dir, "store-link"));
  assert.equal(
    (await loadDefinition(join(f.dir, "store-link"), "sample")).meta.name,
    "sample",
  );
  await symlink(join(store, "sample.js"), join(store, "linked.js"));
  await mkdir(join(store, "directory.js"));
  await writeFile(join(store, "big.js"), " ".repeat(MAX_DEFINITION_BYTES + 1));
  await writeFile(join(store, "mismatch.js"), definitionSource());
  await writeFile(join(store, "unsafe name.js"), definitionSource());
  for (const name of [
    "../sample",
    "/sample",
    "sample.js",
    "linked",
    "directory",
    "big",
    "mismatch",
    "unsafe name",
  ])
    await assert.rejects(loadDefinition(store, name));
  const inventory = await inventoryScripts(store);
  assert.equal(inventory.entries.filter((e) => !e.valid).length, 5);
  assert.equal(inventory.entries.filter((e) => e.valid).length, 1);
  await Promise.all(
    Array.from({ length: 205 }, (_, i) =>
      writeFile(
        join(store, `entry-${i}.js`),
        definitionSource("return null;", { name: `entry-${i}` }),
      ),
    ),
  );
  const bounded = await inventoryScripts(store);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.entries.length <= 200);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 24000);
  assert.equal((await loadDefinition(store, "sample")).meta.name, "sample");
});

test("opened file containment rejects a directory replacement race", async (t) => {
  const f = await fixture(t);
  const root = join(f.dir, "scripts"),
    outside = join(f.dir, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(outside, "sample.js"), definitionSource());
  t.mock.method(_storeHooks, "beforeOpen", async () => {
    await rename(root, join(f.dir, "old"));
    await symlink(outside, root);
  });
  await assert.rejects(loadDefinition(root, "sample"), /unsafe_script_path/);
});

test("named tool validates before provider dispatch and retains inline/describe compatibility", async (t) => {
  let calls = 0;
  const h = await savedFixture(t, {
    echo: {
      ...echo,
      handler: async (args) => {
        calls++;
        return { value: args[0] };
      },
    },
  });
  const path = join(h.store, "sample.js");
  await writeFile(
    path,
    definitionSource("return await fixture.echo(args.n);", {
      providers: ["fixture"],
      args: {
        type: "object",
        properties: { n: { type: "integer" } },
        required: ["n"],
      },
    }),
  );
  const base = {
    action: "run",
    name: "sample",
    providers: ["fixture"],
    args: { n: 4 },
  };
  for (const params of [
    { ...base, args: { n: "4" } },
    { ...base, providers: [] },
    { ...base, source: "return null;" },
    { ...base, name: undefined },
    { ...base, providers: undefined },
  ])
    await assert.rejects(h.call(params));
  assert.equal(calls, 0);
  await h.config({ allowedProviders: [] });
  await assert.rejects(h.call(base), /capability_denied/);
  assert.equal(calls, 0);
  const listed = await h.call({ action: "list" });
  assert.equal(listed.details.entries[0].valid, true);
  await h.call({ action: "validate", name: "sample", args: { n: 4 } });
  assert.equal(calls, 0);
  await h.config({ allowedProviders: ["fixture"] });
  const run = await h.call(base);
  assert.equal(run.details.status, "success");
  assert.match(run.content[1].text, /\n4\n/);
  assert.equal(calls, 1);
  const inline = await h.call({
    action: "run",
    source: "return {inline: true};",
    providers: [],
  });
  assert.equal(inline.details.status, "success");
  assert.equal(
    (await h.call({ action: "describe", providers: [] })).details.providerCount,
    1,
  );
});

test("named background pins source/args/providers/digest and delivers through existing service", async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  const h = await savedFixture(t, {
    echo: {
      ...echo,
      handler: async (args) => {
        await gate;
        return { value: args[0] };
      },
    },
  });
  const path = join(h.store, "sample.js");
  await writeFile(
    path,
    definitionSource("await fixture.echo(1); return args;", {
      providers: ["fixture"],
    }),
  );
  const original = await loadDefinition(h.store, "sample");
  const args = {
    text: "\"; throw Error('injected'); //\u2028",
    nested: { n: 1 },
  };
  const providers = ["fixture"];
  const admitted = await h.call({
    action: "run",
    execution: "background",
    name: "sample",
    args,
    providers,
  });
  const id = admitted.details.records[0].id;
  const terminal = h.terminal();
  args.nested.n = 9;
  providers.length = 0;
  await writeFile(path, definitionSource("throw Error('edited');"));
  await h.config({ allowedProviders: [] });
  release();
  await terminal;
  const record = h.service.inspect("script", id);
  assert.equal(record.status, "success");
  const result = record.result as any;
  assert.equal(JSON.parse(result.json).nested.n, 1);
  assert.equal(JSON.parse(result.json).text, args.text);
  assert.equal(result.definition.digest, original.digest);
  assert.equal(result.traces.length, 1);
  assert.equal(h.messages.length, 1);
  assert.equal(
    h.service.inspect("script", id).notification.handoff,
    "handed_to_pi",
  );
  assert.equal(
    (await h.call({ action: "executions" })).details.records.length,
    1,
  );
  assert.equal(
    (await h.call({ action: "inspect", id })).details.records[0].status,
    "success",
  );
  await h.call({ action: "dismiss", id });
  assert.equal(h.service.inspect("script", id).dismissed, true);
});

test("definition limits narrow host policy and preserve sticky call failures, timeout and cancellation", async (t) => {
  const h = await savedFixture(t, { echo });
  const path = join(h.store, "sample.js");
  await h.config({ allowedProviders: ["fixture"], maxCalls: 1 });
  await writeFile(
    path,
    definitionSource("await fixture.echo(1); return await fixture.echo(2);", {
      providers: ["fixture"],
    }),
  );
  assert.equal(
    (await h.call({ action: "run", name: "sample", providers: ["fixture"] }))
      .details.code,
    "call_limit",
  );
  await h.config({ allowedProviders: ["fixture"] });
  await writeFile(
    path,
    definitionSource("await fixture.echo(1); return await fixture.echo(2);", {
      providers: ["fixture"],
      limits: { maxCalls: 1, maxConcurrency: 1, timeoutMs: 5000 },
    }),
  );
  assert.equal(
    (await h.call({ action: "run", name: "sample", providers: ["fixture"] }))
      .details.code,
    "call_limit",
  );
  await writeFile(
    path,
    definitionSource("while(true) {}", {
      limits: { maxCalls: 1, maxConcurrency: 1, timeoutMs: 80 },
    }),
  );
  assert.equal(
    (await h.call({ action: "run", name: "sample", providers: [] })).details
      .status,
    "timeout",
  );
  await writeFile(path, definitionSource("while(true) {}"));
  const admitted = await h.call({
    action: "run",
    name: "sample",
    providers: [],
    execution: "background",
  });
  const terminal = h.terminal();
  await h.call({ action: "cancel", id: admitted.details.records[0].id });
  await terminal;
  assert.equal(h.service.list("script")[0].status, "cancelled");
});

test("prepared API snapshots arguments and provider selection before asynchronous setup", async (t) => {
  const f = await fixture(t, { echo });
  const args = { n: 1 },
    providers = ["fixture"];
  const pending = prepareScript(f.pi, f.dir, {
    source: "return await fixture.echo(args.n);",
    args,
    providers,
    limits: { maxCalls: 2, maxConcurrency: 1, timeoutMs: 5000 },
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 5000,
  });
  args.n = 2;
  providers.length = 0;
  const prepared = await pending;
  assert.equal((await prepared.run(new AbortController().signal)).json, "1");
  assert.throws(() => prepared.run(new AbortController().signal), /consumed/);
  assert.equal(parseConfig({ userScriptsDir: "relative" }, {}).valid, false);
});
