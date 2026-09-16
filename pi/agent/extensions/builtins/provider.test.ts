import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createReadTool,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  describeScriptProviders,
  executeScript,
  type ScriptMethod,
} from "../script/api.ts";
import { fixture, echo, limits } from "../script/fixture.ts";
import builtins from "./index.ts";

async function setup(
  t: TestContext,
  methods: Record<string, ScriptMethod> = { echo },
) {
  const f = await fixture(t, methods);
  await f.config({ allowedProviders: ["builtins", "fixture"] });
  let active = ["read", "write", "edit", "bash", "ls", "find", "grep"];
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const tools: any[] = [];
  const pi = {
    ...f.pi,
    on: (name: string, handler: (...args: any[]) => unknown) =>
      handlers.set(name, handler),
    getActiveTools: () => active,
    getAllTools: () => active.map((name) => ({ name })),
    registerTool: (tool: unknown) => tools.push(tool),
  } as unknown as ExtensionAPI;
  builtins(pi);
  handlers.get("session_start")!({}, { cwd: f.dir });
  t.after(() => handlers.get("session_shutdown")!());
  return {
    ...f,
    pi,
    tools,
    handlers,
    disable: (name: string) => {
      active = active.filter((v) => v !== name);
    },
    enable: (name: string) => {
      active.push(name);
    },
    run: (source: string, options: Parameters<typeof f.run>[1] = {}) =>
      f.run(source, { providers: ["builtins", "fixture"], ...options }),
  };
}

test("discovery mirrors live active methods, selection and schema admission fail closed", async (t) => {
  const f = await setup(t);
  const describe = () => describeScriptProviders(f.pi, f.dir, ["builtins"]);
  const initial = (await describe())[0];
  assert.deepEqual(
    initial.methods.map((m) => m.name).sort(),
    [
      "read",
      "write",
      "edit",
      "bash",
      "ls",
      "find",
      "grep",
      ...(process.platform === "win32" ? ["powershell"] : []),
    ].sort(),
  );
  assert.ok(initial.methods.find((m) => m.name === "write")?.available);
  f.disable("write");
  assert.equal(
    (await describe())[0].methods.find((m) => m.name === "write")?.available,
    false,
  );
  const denied = await f.run(
    'try { await builtins.write({path:"denied", content:"no"}); } catch {} return null;',
  );
  assert.equal(denied.status, "failed");
  assert.equal(denied.traces[0].code, "capability_unavailable");
  assert.equal(denied.traces[0].dispatched, false);
  await assert.rejects(access(join(f.dir, "denied")));
  f.enable("write");
  const invalid = await f.run(
    'try { await builtins.write({path:"invalid"}); } catch {} return null;',
  );
  assert.equal(invalid.traces[0].code, "invalid_arguments");
  assert.equal(invalid.effectsMayPersist, false);
  await f.config({ allowedProviders: ["fixture"] });
  assert.equal((await f.run("return null;")).code, "capability_denied");
});

test("real sequential write/edit/read preserves structured results and fixture composition", async (t) => {
  const f = await setup(t);
  let hooks = 0;
  f.pi.events.on("tool_call", () => hooks++);
  f.pi.events.on("tool_result", () => hooks++);
  const result = await f.run(`
    const write = await builtins.write({path:"nested/file.txt", content:"one\\ntwo\\n"});
    const edit = await builtins.edit({path:"nested/file.txt", edits:[{oldText:"two",newText:"three"}]});
    const read = await builtins.read({path:"nested/file.txt"});
    return {write, edit, read, count: await fixture.echo(read.content.length)};
  `);
  assert.equal(result.status, "success");
  const value = JSON.parse(result.json!);
  assert.deepEqual(value.read, {
    content: [{ type: "text", text: "one\nthree\n" }],
  });
  assert.match(value.edit.details.diff, /three/);
  assert.match(value.edit.details.patch, /three/);
  assert.equal(value.count, 1);
  assert.equal(
    await readFile(join(f.dir, "nested/file.txt"), "utf8"),
    "one\nthree\n",
  );
  assert.equal(hooks, 0);
  const failed = await f.run(
    'await builtins.write({path:"survives",content:"kept"}); try {await builtins.read({path:"missing"});} catch {} return "caught";',
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.json, '"caught"');
  assert.equal(failed.partialExecution, true);
  assert.equal(failed.outcomeUnknown, true);
  assert.equal(await readFile(join(f.dir, "survives"), "utf8"), "kept");
});

test("concurrent callers retain distinct cwd and immutable shell session snapshots", async (t) => {
  const f = await setup(t);
  const dirs = [join(f.dir, "a"), join(f.dir, "b")];
  await Promise.all(dirs.map((dir) => mkdir(dir)));
  const sessions = [
    { id: "session-a", model: "model-a" },
    { id: "session-b", model: "model-b" },
  ];
  const runs = dirs.map((cwd, i) =>
    executeScript(f.pi, cwd, {
      source: `await builtins.write({path:"local",content:"${i}"}); return await builtins.bash({command:'printf "%s|%s|%s" "$PWD" "$PI_SESSION_ID" "$PI_MODEL"'});`,
      providers: ["builtins"],
      limits,
      signal: new AbortController().signal,
      deadlineMs: Date.now() + 5000,
      session: sessions[i],
    }),
  );
  sessions[0].id = "later-unrelated-session";
  const results = await Promise.all(runs);
  for (const [i, result] of results.entries()) {
    assert.equal(result.status, "success");
    const text = JSON.parse(result.json!).content[0].text;
    assert.match(text, new RegExp(`session-${i === 0 ? "a" : "b"}`));
    assert.match(text, new RegExp(`/[ab]\\|session-`));
    assert.equal(await readFile(join(dirs[i], "local"), "utf8"), String(i));
  }
});

test("structured truncation, listings and image rejection preserve direct read", async (t) => {
  const f = await setup(t);
  await writeFile(join(f.dir, "large"), "abc\n".repeat(2100));
  const truncated = await f.run(
    'const r=await builtins.read({path:"large"}); return {details:r.details, text:r.content[0].text.slice(-120)};',
  );
  assert.equal(truncated.status, "success");
  assert.equal(JSON.parse(truncated.json!).details.truncation.truncated, true);
  const listing = await f.run('return await builtins.ls({path:"."});');
  assert.match(JSON.parse(listing.json!).content[0].text, /large/);
  // Pi's MIME detection reads actual bytes, not the extension alone.
  await writeFile(
    join(f.dir, "pixel.gif"),
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  );
  const direct = await createReadTool(f.dir).execute("direct", {
    path: "pixel.gif",
  });
  assert.ok(direct.content.some((c) => c.type === "image"));
  const image = await f.run(
    'try {return await builtins.read({path:"pixel.gif"});} catch(e) {return e.code;}',
  );
  assert.equal(image.status, "failed");
  assert.equal(image.json, '"unsupported_image_use_direct_read"');
  assert.equal(image.outcomeUnknown, false);
  assert.ok(!JSON.stringify(image).includes("R0lGOD"));
});

test("parallel mutations obey call limits and oversized explicit results are not replayed", async (t) => {
  const f = await setup(t);
  const parallel = await f.run(
    'return await parallel([() => builtins.write({path:"a",content:"a"}), () => builtins.write({path:"b",content:"b"})]);',
  );
  assert.equal(parallel.status, "success");
  assert.equal(await readFile(join(f.dir, "a"), "utf8"), "a");
  assert.equal(await readFile(join(f.dir, "b"), "utf8"), "b");
  const limited = await f.run(
    'await builtins.write({path:"first",content:"kept"}); await builtins.write({path:"excess",content:"no"}); return null;',
    { limits: { ...limits, maxCalls: 1 } },
  );
  assert.equal(limited.code, "call_limit");
  assert.equal(await readFile(join(f.dir, "first"), "utf8"), "kept");
  await assert.rejects(access(join(f.dir, "excess")));
  await writeFile(join(f.dir, "big"), "x".repeat(30000));
  const oversized = await f.run('return await builtins.read({path:"big"});');
  assert.equal(oversized.code, "output_limit");
  assert.equal(oversized.traces.length, 1);
  assert.equal(oversized.json, undefined);
});

test("FIFO revocation blocks queued writes without dispatch", async (t) => {
  let disable = () => {};
  const f = await setup(t, {
    revoke: {
      ...echo,
      handler: async () => {
        disable();
        return { value: null };
      },
    },
  });
  disable = () => f.disable("write");
  const result = await f.run(
    'await Promise.allSettled([fixture.revoke(1), builtins.write({path:"queued",content:"no"})]); return null;',
    { limits: { ...limits, maxConcurrency: 1 } },
  );
  assert.equal(result.status, "failed");
  assert.equal(result.traces[1].dispatched, false);
  assert.equal(result.traces[1].code, "capability_unavailable");
  await assert.rejects(access(join(f.dir, "queued")));
});

async function waitForFile(path: string) {
  for (let n = 0; n < 100; n++) {
    try {
      await access(path);
      return;
    } catch {
      await delay(10);
    }
  }
  throw new Error("shell did not start");
}

for (const stop of ["cancel", "navigation", "shutdown"] as const) {
  test(`${stop} aborts real shell, closes queued admission and cannot revive late results`, async (t) => {
    const f = await setup(t);
    const abort = new AbortController();
    const run = f.run(
      'await Promise.all([builtins.bash({command:"printf started > started; sleep 10; printf late > late"}), builtins.write({path:"queued",content:"no"})]); return null;',
      { signal: abort.signal, limits: { ...limits, maxConcurrency: 1 } },
    );
    await waitForFile(join(f.dir, "started"));
    if (stop === "cancel") abort.abort();
    else
      f.handlers.get(
        stop === "navigation" ? "session_tree" : "session_shutdown",
      )!({}, { cwd: f.dir });
    const result = await run;
    assert.equal(result.status, "cancelled");
    assert.equal(result.outcomeUnknown, true);
    await assert.rejects(access(join(f.dir, "queued")));
    await assert.rejects(access(join(f.dir, "late")));
    const receipt = JSON.stringify(result);
    await delay(40);
    assert.equal(JSON.stringify(result), receipt);
  });
}

test("deadline and bounded shell failure stay sticky after guest catches", async (t) => {
  const f = await setup(t);
  const timeout = await f.run(
    'return await builtins.bash({command:"sleep 10"});',
    { limits: { ...limits, timeoutMs: 200 } },
  );
  assert.equal(timeout.status, "timeout");
  const failed = await f.run(
    'try {await builtins.bash({command:"exit 7",timeout:1});} catch {} return null;',
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.traces[0].code, "builtin_failed");
});
