import assert from "node:assert/strict";
import test from "node:test";

import { createConcurrencyGate } from "./pool.ts";

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("gate enforces its limit and preserves FIFO order", async () => {
  const gate = createConcurrencyGate(2);
  const admitted: number[] = [];
  const releases: Array<() => void> = [];

  const acquisitions = [0, 1, 2, 3].map(async (value) => {
    const release = await gate.acquire();
    assert.ok(release);
    admitted.push(value);
    releases[value] = release;
  });

  await flush();
  assert.deepEqual(admitted, [0, 1]);
  releases[0]!();
  await flush();
  assert.deepEqual(admitted, [0, 1, 2]);
  releases[1]!();
  await flush();
  assert.deepEqual(admitted, [0, 1, 2, 3]);
  releases[2]!();
  releases[3]!();
  await Promise.all(acquisitions);
});

test("gate raises and lowers its limit without exceeding the current limit", async () => {
  const gate = createConcurrencyGate(2);
  const first = await gate.acquire();
  const second = await gate.acquire();
  assert.ok(first);
  assert.ok(second);

  let thirdAdmitted = false;
  const thirdPromise = gate.acquire().then((release) => {
    thirdAdmitted = true;
    return release;
  });
  await flush();

  gate.setLimit(1);
  first();
  await flush();
  assert.equal(thirdAdmitted, false);
  second();
  await flush();
  assert.equal(thirdAdmitted, true);
  (await thirdPromise)!();

  const held = await gate.acquire();
  assert.ok(held);
  const fourthPromise = gate.acquire();
  const fifthPromise = gate.acquire();
  await flush();
  gate.setLimit(3);
  assert.ok(await fourthPromise);
  assert.ok(await fifthPromise);
  held();
  (await fourthPromise)!();
  (await fifthPromise)!();
});

test("queued abort removes the waiter without consuming a slot", async () => {
  const gate = createConcurrencyGate(1);
  const first = await gate.acquire();
  assert.ok(first);
  const controller = new AbortController();
  const aborted = gate.acquire(controller.signal);
  const next = gate.acquire();

  controller.abort();
  assert.equal(await aborted, undefined);
  first();
  assert.ok(await next);
  (await next)!();
});

test("release is idempotent", async () => {
  const gate = createConcurrencyGate(1);
  const first = await gate.acquire();
  assert.ok(first);
  let admissions = 0;
  const second = gate.acquire().then((release) => {
    admissions += 1;
    return release;
  });

  first();
  first();
  assert.ok(await second);
  assert.equal(admissions, 1);
  (await second)!();
});

test("aborted acquisition is cancellation while invalid limits reject normally", async () => {
  const gate = createConcurrencyGate(1);
  const controller = new AbortController();
  controller.abort();
  assert.equal(await gate.acquire(controller.signal), undefined);
  assert.throws(() => gate.setLimit(0), /positive integer/);
  assert.throws(() => gate.setLimit(1.5), /positive integer/);
  assert.throws(() => createConcurrencyGate(Number.NaN), /positive integer/);
});
