import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonSnapshot } from "./value.ts";
import { fixture, echo } from "./fixture.ts";

test("host snapshots reject lossy provider JSON without invoking accessors/toJSON", () => {
  let invoked = false;
  const getter = {
    get secret() {
      invoked = true;
      return "PRIVATE";
    },
  };
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(),
    getter,
    {
      toJSON() {
        invoked = true;
        return 1;
      },
    },
    [, 1],
    Object.assign(Array(1), { 4294967295: 1 }),
  ])
    assert.throws(() => jsonSnapshot(value));
  assert.equal(invoked, false);
  assert.equal(
    jsonSnapshot({ value: [1, true, null] }),
    '{"value":[1,true,null]}',
  );
  assert.throws(() => jsonSnapshot("oversized", 3), /output_limit/);
});

test("invalid and over-limit provider values become sticky unknown failures; IPC envelope limits terminate", async (t) => {
  const f = await fixture(t, {
    invalid: { ...echo, handler: async () => ({ value: new Date() as any }) },
    oversized: {
      ...echo,
      handler: async () => ({ value: "PRIVATE".repeat(3 * 1024 * 1024) }),
    },
    unknown: {
      ...echo,
      handler: async () => ({ value: null, outcomeUnknown: true }),
    },
  });
  for (const method of ["invalid", "oversized", "unknown"]) {
    const r = await f.run(
      `try { await fixture.${method}(1); } catch {} return null;`,
    );
    assert.equal(r.status, "failed");
    assert.equal(r.outcomeUnknown, true);
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
  }
  const r = await f.run('return "x".repeat(17 * 1024 * 1024);');
  assert.equal(r.code, "ipc_limit");
  assert.equal(r.json, undefined);
  const extra = await f.run("return Object.assign(Array(1), {4294967295: 1});");
  assert.equal(extra.code, "invalid_result");
});
