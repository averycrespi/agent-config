import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, echo } from "../script/fixture.ts";
import { describeScriptProviders } from "../script/api.ts";
import {
  describeEvents,
  registerBackgroundProvider,
  subscribeProvider,
  type EventSource,
} from "./providers.ts";
const event: EventSource = {
  description: "Safe integer changes",
  inputSchema: { type: "array", maxItems: 0 },
  payloadSchema: { type: "integer" },
  subscribe: async () => ({ coverage: { at: 1 }, close() {} }),
};
test("typed event registration is atomic, immutable and shares Script admission/revocation", async (t) => {
  const f = await fixture(t);
  const invalid = {
    namespace: "fixture",
    available: () => true,
    methods: { echo },
    events: {
      change: { ...event, payloadSchema: { type: "string", nonsense: true } },
    },
  };
  assert.throws(() => registerBackgroundProvider(f.pi, invalid));
  assert.deepEqual(await describeScriptProviders(f.pi, f.dir, []), []);
  let emit!: (value: any) => void,
    lost = 0,
    closed = 0;
  const dispose = registerBackgroundProvider(f.pi, {
    ...invalid,
    events: {
      change: {
        ...event,
        subscribe: async (_args, ctx) => {
          emit = ctx.emit;
          return { coverage: null, close: () => closed++ };
        },
      },
    },
  });
  t.after(dispose);
  assert.throws(() =>
    registerBackgroundProvider(f.pi, { ...invalid, events: { change: event } }),
  );
  const found = await describeEvents(f.pi, f.dir, []);
  assert.equal(found[0].provider, "fixture");
  const received: any[] = [];
  const ctx = {
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 5000,
    emit: (v: any) => received.push(v),
    lost: () => lost++,
  };
  const selection = { provider: "fixture", event: "change", args: [] };
  await assert.rejects(
    subscribeProvider(f.pi, f.dir, [], selection, ctx),
    /denied/,
  );
  const sub = await subscribeProvider(f.pi, f.dir, ["fixture"], selection, ctx);
  emit(2);
  emit({ raw: "PRIVATE" });
  assert.deepEqual(received, [2]);
  assert.equal(lost, 1);
  dispose();
  assert.equal(lost, 2);
  sub.close();
  assert.equal(closed, 1);
  await assert.rejects(
    subscribeProvider(f.pi, f.dir, ["fixture"], selection, ctx),
  );
});
test("cancelled setup rejects promptly and closes a late provider subscription without replay", async (t) => {
  const f = await fixture(t);
  let resolve!: (value: any) => void,
    entered!: () => void,
    closed = 0;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  const dispose = registerBackgroundProvider(f.pi, {
    namespace: "fixture",
    available: () => true,
    methods: { echo },
    events: {
      change: {
        ...event,
        subscribe: () => {
          entered();
          return new Promise((r) => {
            resolve = r;
          });
        },
      },
    },
  });
  t.after(dispose);
  const c = new AbortController();
  const pending = subscribeProvider(
    f.pi,
    f.dir,
    ["fixture"],
    { provider: "fixture", event: "change", args: [] },
    { signal: c.signal, deadlineMs: Date.now() + 5000, emit() {}, lost() {} },
  );
  await ready;
  c.abort();
  await assert.rejects(pending);
  resolve({ coverage: null, close: () => closed++ });
  await new Promise((r) => setImmediate(r));
  assert.equal(closed, 1);
});
