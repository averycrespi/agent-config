import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { runScript } from "../script/runtime.ts";
import { createBridge } from "../script/bridge.ts";
import { parseReceipt, restore, RECEIPT_TYPE } from "./receipts.ts";
import type { Receipt } from "./contract.ts";
import { MAX_DURATION_MS } from "./config.ts";

function receipt(): Receipt {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    name: "fixture",
    createdAt: 1000,
    deadline: 10000,
    cycleDeadline: 5000,
    cycleMs: 4000,
    status: "finished",
    recurring: false,
    maxWakes: 1,
    wakes: 1,
    evaluations: 3,
    calls: 0,
    inFlight: false,
    awaitingSettlement: false,
    state: { count: 3 },
    evidence: { count: 3 },
    coverage: [],
    gap: false,
    interrupted: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
  };
}

test("historical configured ceilings restore against technical safety, not current policy", () => {
  const r = {
    ...receipt(),
    deadline: 1000 + MAX_DURATION_MS,
    cycleMs: MAX_DURATION_MS,
    delayMs: MAX_DURATION_MS,
  };
  assert.deepEqual(parseReceipt(r), r);
  for (const patch of [
    { deadline: r.deadline + 1 },
    { cycleMs: MAX_DURATION_MS + 1 },
    { delayMs: MAX_DURATION_MS + 1 },
  ])
    assert.equal(parseReceipt({ ...r, ...patch }), undefined);
});

test("legacy successful runtime accounting restores latest in-memory receipt like disk JSON", async () => {
  const result = await runScript(
    "return {decision:'wake',evidence:null};",
    createBridge([]),
  );
  assert.equal(result.status, "success");
  const { json: _json, ...accounting } = result;
  // Explicitly retain the legacy shape even if Script later omits absent fields.
  const latest = {
    ...receipt(),
    accounting: { ...accounting, code: undefined },
  };
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(RECEIPT_TYPE, {
    ...receipt(),
    status: "active",
    evaluations: 1,
    wakes: 0,
  });
  manager.appendCustomEntry(RECEIPT_TYPE, latest);
  const expected = JSON.parse(JSON.stringify(latest));
  assert.deepEqual(restore(manager), [expected]);
  assert.deepEqual(parseReceipt(latest), parseReceipt(expected));
  assert.equal(Object.hasOwn(latest.accounting, "code"), true);
  assert.equal(latest.accounting.code, undefined);
});

test("legacy normalization preserves strict validation and never invokes accessors", () => {
  const accounting = {
    status: "success",
    traces: [],
    partialExecution: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
    code: undefined,
  };
  const latest = { ...receipt(), accounting };
  assert.ok(parseReceipt(latest));
  assert.equal(
    parseReceipt({ ...latest, evidence: { bad: undefined } }),
    undefined,
  );
  assert.equal(
    parseReceipt({
      ...latest,
      accounting: { ...accounting, extra: undefined },
    }),
    undefined,
  );
  assert.equal(
    parseReceipt({ ...latest, accounting: { ...accounting, code: 123 } }),
    undefined,
  );
  assert.equal(
    parseReceipt({
      ...latest,
      accounting: { ...accounting, code: "BAD CODE" },
    }),
    undefined,
  );
  let invoked = false;
  const getter = {
    enumerable: true,
    get() {
      invoked = true;
      return undefined;
    },
  };
  for (const field of ["accounting", "code", "evidence"]) {
    const r = { ...latest, accounting: { ...accounting } };
    Object.defineProperty(field === "code" ? r.accounting : r, field, getter);
    assert.equal(parseReceipt(r), undefined);
    assert.equal(invoked, false);
  }
  const hidden = { ...accounting };
  Object.defineProperty(hidden, "code", {
    value: undefined,
    enumerable: false,
  });
  assert.equal(parseReceipt({ ...latest, accounting: hidden }), undefined);
  const symbol = { ...accounting, [Symbol("bad")]: 1 };
  assert.equal(parseReceipt({ ...latest, accounting: symbol }), undefined);
  const failed = {
    ...latest,
    accounting: { ...accounting, status: "failed", code: "script_error" },
  };
  assert.equal(parseReceipt(failed)?.accounting?.code, "script_error");
});
