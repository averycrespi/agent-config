import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, echo } from "../script/fixture.ts";
import { evaluateBackground } from "./execution.ts";
import { LIMITS, observation, registration } from "./contract.ts";
const reg = (source: string) =>
  registration({
    name: "fixture",
    message: "Inspect",
    providers: ["fixture"],
    source,
    interval_ms: 1000,
    cycle_timeout_ms: 5000,
    lifetime_ms: 10000,
    max_wakes: 1,
  });
test("actual Script children receive only explicit trigger/state, fresh globals, and provider calls", async (t) => {
  const f = await fixture(t, { echo });
  const input = reg(
    "globalThis.local = (globalThis.local ?? 0) + 1; const n = await fixture.echo(state + 1); return {decision:'wait', evidence:{local:globalThis.local, trigger, fs:typeof process}, state:n};",
  );
  const run = (state: number) =>
    evaluateBackground(
      f.pi,
      f.dir,
      input,
      { kind: "event", at: 1, payload: { revision: 2 } },
      state,
      new AbortController().signal,
      Date.now() + 5000,
    );
  const a = observation(await run(0));
  const b = observation(await run(a.state as number));
  assert.equal(b.state, 2);
  assert.deepEqual(b.evidence, {
    local: 1,
    trigger: { kind: "event", at: 1, payload: { revision: 2 } },
    fs: "undefined",
  });
});
test("actual caught provider failure cannot become a committed Background observation", async (t) => {
  const f = await fixture(t, {
    echo: {
      ...echo,
      handler: async () => ({
        value: null,
        isError: true,
        outcomeUnknown: true,
      }),
    },
  });
  const r = await evaluateBackground(
    f.pi,
    f.dir,
    reg(
      "try {await fixture.echo(1);} catch {} return {decision:'wake', evidence:'not committed', state:2};",
    ),
    { kind: "initial", at: 1 },
    1,
    new AbortController().signal,
    Date.now() + 5000,
  );
  assert.equal(r.status, "failed");
  assert.equal(r.effectsMayPersist, true);
  assert.equal(r.outcomeUnknown, true);
  assert.throws(() => observation(r));
});
test("actual evaluator respects malformed global policy and cannot bypass cancellation", async (t) => {
  const f = await fixture(t, { echo });
  await f.config({ allowedProviders: null });
  const c = new AbortController();
  const run = () =>
    evaluateBackground(
      f.pi,
      f.dir,
      reg("return {decision:'wake', evidence:null};"),
      { kind: "initial", at: 1 },
      null,
      c.signal,
      Date.now() + 5000,
    );
  assert.equal((await run()).code, "invalid_config");
  c.abort();
  assert.equal((await run()).status, "cancelled");
});

test("state and event JSON preserve own nested __proto__ properties in actual children", async (t) => {
  const f = await fixture(t, { echo });
  const data = JSON.parse(
    '{"__proto__":{"ready":true},"nested":{"__proto__":{"secret":1}},"text":"quote \\\" and newline\\n"}',
  );
  const result = await evaluateBackground(
    f.pi,
    f.dir,
    reg(
      "return {decision:'wait', evidence:{payload:trigger.payload, inherited:state.ready === true, own:Object.hasOwn(state,'__proto__')}, state};",
    ),
    { kind: "event", at: 1, payload: data },
    data,
    new AbortController().signal,
    Date.now() + 5000,
  );
  assert.equal(result.status, "success", result.code);
  const value = observation(result);
  assert.deepEqual(value.state, data);
  assert.deepEqual(value.evidence, {
    payload: data,
    inherited: false,
    own: true,
  });
});

test("maximum source leaves room for escaped state and trigger input", async (t) => {
  const f = await fixture(t, { echo });
  const body = "return {decision:'wait', evidence:trigger.payload, state};";
  const data = '\\"'.repeat(1000);
  const result = await evaluateBackground(
    f.pi,
    f.dir,
    reg(" ".repeat(LIMITS.source - body.length) + body),
    { kind: "event", at: 1, payload: data },
    data,
    new AbortController().signal,
    Date.now() + 5000,
  );
  assert.equal(result.status, "success", result.code);
  assert.deepEqual(observation(result), {
    decision: "wait",
    evidence: data,
    state: data,
  });
});
