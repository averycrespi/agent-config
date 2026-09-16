import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fixture, echo, limits } from "./fixture.ts";
import { _spawn } from "./runtime.ts";
import { presentRun } from "./tool.ts";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("pure execution is fresh and has no ambient privileged APIs", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const r = await f.run(
      "globalThis.count = (globalThis.count ?? 0) + 1; return [count, typeof process, typeof require, typeof fetch, typeof Buffer, typeof setTimeout, typeof mcp];",
    );
    assert.equal(r.status, "success");
    assert.deepEqual(JSON.parse(r.json!), [1, ...Array(6).fill("undefined")]);
    assert.equal(r.effectsMayPersist, false);
  }
  for (const source of [
    'return (await import("node:fs")).readFileSync("/etc/passwd");',
    'return (await import("node:net")).connect(80,"example.com");',
    'return (await import("node:child_process")).execSync("echo denied");',
    'return (await import("data:text/javascript,export default 1")).default;',
    'return globalThis.constructor.constructor("return process")();',
    'return eval("1");',
    "return new WebAssembly.Module(new Uint8Array());",
  ]) {
    assert.equal((await f.run(source)).code, "script_error", source);
  }
});

test("fixture calls compose through real IPC; host concurrency and count ceilings apply", async (t) => {
  let active = 0,
    peak = 0,
    calls = 0;
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async (args) => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await delay(15);
        active--;
        return { value: args[0] };
      },
    },
  });
  const r = await f.run(
    "return await Promise.all([1,2,3,4,5].map(x => fixture.echo(x)));",
  );
  assert.equal(r.status, "success");
  assert.deepEqual(JSON.parse(r.json!), [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  assert.equal(r.traces.length, 5);
  const capped = await f.run(
    "for(let i=0;i<4;i++) { try { await fixture.echo(i); } catch {} } return null;",
    { limits: { ...limits, maxCalls: 2 } },
  );
  assert.equal(capped.code, "call_limit");
  assert.equal(capped.traces.length, 2);
  assert.equal(calls, 7);
  const p = await f.run(
    "return await parallel([() => fixture.echo(7), () => fixture.echo(9)]);",
  );
  assert.deepEqual(JSON.parse(p.json!), [7, 9]);
});

test("argument rejection is pre-dispatch, sticky, and excludes raw inputs", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async () => {
        calls++;
        return { value: null };
      },
    },
  });
  const r = await f.run(
    'try { await fixture.echo("PRIVATE_INPUT"); } catch {} return "caught";',
  );
  assert.equal(r.status, "failed");
  assert.equal(r.code, "nested_call_failed");
  assert.equal(r.traces[0].code, "invalid_arguments");
  assert.equal(r.effectsMayPersist, false);
  assert.equal(calls, 0);
  assert.doesNotMatch(JSON.stringify(presentRun(r)), /PRIVATE_INPUT/);
});

test("known failures, unknown exceptions and guest catches preserve partial effects without diagnostic payloads", async (t) => {
  let writes = 0;
  const secret = "PRIVATE_CREDENTIAL_AND_INTERMEDIATE";
  const f = await fixture(t, {
    write: {
      ...echo,
      handler: async () => {
        writes++;
        return { value: secret };
      },
    },
    fail: { ...echo, handler: async () => ({ value: secret, isError: true }) },
    unknown: {
      ...echo,
      handler: async () => {
        throw new Error(secret);
      },
    },
  });
  const r = await f.run(
    "await fixture.write(1); await fixture.fail(1); try { await fixture.unknown(1); } catch {} return null;",
  );
  assert.equal(writes, 1);
  assert.equal(r.code, "nested_call_failed");
  assert.equal(r.partialExecution, true);
  assert.equal(r.outcomeUnknown, true);
  assert.deepEqual(
    r.traces.map((t) => t.state),
    ["succeeded", "failed", "failed"],
  );
  assert.equal(r.traces[1].outcomeUnknown, false);
  assert.equal(r.traces[2].outcomeUnknown, true);
  assert.doesNotMatch(JSON.stringify(presentRun(r)), /PRIVATE/);
  const thrown = await f.run("throw new Error(await fixture.write(1));");
  assert.equal(thrown.code, "script_error");
  assert.doesNotMatch(JSON.stringify(thrown), /PRIVATE/);
});

test("cancellation closes admission, awaits child exit, and ignores late settlements", async (t) => {
  const entered = deferred<void>();
  const late = deferred<{ value: null }>();
  let calls = 0,
    aborted = false;
  const pids: number[] = [];
  const original = _spawn.fn;
  t.mock.method(_spawn, "fn", (...args: Parameters<typeof original>) => {
    const child = original(...args);
    pids.push(child.pid!);
    return child;
  });
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async (_args, ctx) => {
        calls++;
        ctx.signal.addEventListener("abort", () => {
          aborted = true;
        });
        entered.resolve();
        return late.promise;
      },
    },
  });
  const controller = new AbortController();
  const pending = f.run(
    "await Promise.all([fixture.echo(1), fixture.echo(2)]); return null;",
    { signal: controller.signal, limits: { ...limits, maxConcurrency: 1 } },
  );
  await entered.promise;
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.outcomeUnknown, true);
  assert.equal(aborted, true);
  assert.equal(calls, 1);
  assert.throws(() => process.kill(pids[0], 0), /ESRCH/);
  const before = JSON.stringify(result);
  late.resolve({ value: null });
  await delay(10);
  assert.equal(JSON.stringify(result), before);
});

test("deadline kills synchronous loops and unregister aborts selected executions", async (t) => {
  const entered = deferred<void>();
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async () => {
        entered.resolve();
        return new Promise(() => {});
      },
    },
  });
  assert.equal(
    (await f.run("while(true) {}", { limits: { ...limits, timeoutMs: 150 } }))
      .status,
    "timeout",
  );
  const pending = f.run("await fixture.echo(1); return null;");
  await entered.promise;
  f.dispose();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(result.outcomeUnknown, true);
});

test("explicit strict JSON, source/output limits, unfinished calls and immutable namespace", async (t) => {
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async (args) => {
        await delay(30);
        return { value: args[0] };
      },
    },
  });
  for (const expression of [
    "undefined",
    "NaN",
    "Infinity",
    "1n",
    "() => 1",
    "new Date()",
    "{ get x() { return 1; } }",
    "[,1]",
    'Object.defineProperty({}, "x", {value:1})',
    "(() => {const x={};x.x=x;return x})()",
  ])
    assert.equal(
      (await f.run(`return ${expression};`)).code,
      "invalid_result",
      expression,
    );
  assert.equal((await f.run('return "a".repeat(24001);')).code, "output_limit");
  assert.equal(
    (await f.run("return null;" + " ".repeat(262144))).code,
    "invalid_source",
  );
  assert.equal(
    (await f.run("fixture.echo = () => 1; return null;")).code,
    "script_error",
  );
  const r = await f.run(
    'Object.prototype.toJSON = () => "bad"; return {ok: true};',
  );
  assert.equal(r.json, '{"ok":true}');
  const unfinished = await f.run("fixture.echo(1); return null;");
  assert.equal(unfinished.code, "unfinished_calls");
});

test("compromised bootstrap cannot forge authority, call IDs, or unselected methods", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async () => {
        calls++;
        return { value: null };
      },
    },
  });
  const original = _spawn.fn;
  for (const message of [
    {
      type: "call",
      id: 1,
      name: "fixture.echo",
      args: [1],
      authority: "admin",
    },
    { type: "call", id: 3, name: "fixture.echo", args: [1] },
    { type: "budget", maxCalls: 1000 },
    { type: "call", id: 1, name: "PRIVATE_UNSELECTED", args: [1] },
  ]) {
    const mock = t.mock.method(
      _spawn,
      "fn",
      (...args: Parameters<typeof original>) => {
        const child = original(...args);
        child.stdin!.end(
          `process.send(${JSON.stringify(JSON.stringify(message))}); process.on('message', () => process.send(JSON.stringify({type:'result',json:'null'})));`,
        );
        return Object.assign(child, { stdin: undefined });
      },
    );
    const r = await f.run("return null;", { providers: [] });
    assert.equal(r.status, "failed");
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE_UNSELECTED/);
    mock.mock.restore();
  }
  assert.equal(calls, 0);
});
