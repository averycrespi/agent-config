import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflowRunLedger } from "./ledger.ts";

test("ledger reserves each logical request once and enforces the call cap", () => {
  const ledger = createWorkflowRunLedger({ maxAgents: 2 });
  assert.equal(ledger.reserve(1), undefined);
  assert.equal(ledger.reserve(1), undefined);
  assert.equal(ledger.reserve(2), undefined);
  assert.equal(ledger.reserve(3), "workflow_run_cap_exceeded");
  assert.deepEqual(ledger.snapshot(), {
    total: null,
    used: 0,
    launched: 2,
    maxAgents: 2,
  });
  assert.equal(Object.isFrozen(ledger.snapshot()), true);
});

test("ledger replaces cumulative attempt usage and sums retries", () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 100 });
  ledger.recordTokens(1, 1, 10);
  ledger.recordTokens(1, 1, 30);
  ledger.recordTokens(1, 1, 30);
  ledger.recordTokens(1, 2, 25);
  ledger.recordTokens(2, 1, 5);
  assert.equal(ledger.snapshot().used, 60);
  assert.equal(ledger.isTokenExceeded(), false);
});

test("token exhaustion is sticky and independent from the call cap", () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 10, maxAgents: 1 });
  assert.equal(ledger.reserve(1), undefined);
  assert.equal(ledger.reserve(2), "workflow_run_cap_exceeded");
  ledger.recordTokens(1, 1, 10);
  assert.equal(ledger.isTokenExceeded(), true);
  assert.equal(ledger.reserve(1), "workflow_budget_exceeded");
  assert.equal(ledger.reserve(3), "workflow_budget_exceeded");
  assert.deepEqual(ledger.snapshot(), {
    total: 10,
    used: 10,
    launched: 1,
    maxAgents: 1,
  });
});

test("disabled limits are mirrored as null", () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 0, maxAgents: 0 });
  for (let requestId = 1; requestId <= 200; requestId += 1) {
    assert.equal(ledger.reserve(requestId), undefined);
  }
  ledger.recordTokens(1, 1, 1_000_000);
  assert.deepEqual(ledger.snapshot(), {
    total: null,
    used: 1_000_000,
    launched: 200,
    maxAgents: null,
  });
  assert.equal(ledger.isTokenExceeded(), false);
});

test("listeners receive fresh snapshots for reservations and usage changes", () => {
  const ledger = createWorkflowRunLedger({ maxTokens: 20, maxAgents: 3 });
  const snapshots: unknown[] = [];
  const unsubscribe = ledger.subscribe((snapshot) => snapshots.push(snapshot));
  ledger.reserve(1);
  ledger.recordTokens(1, 1, 5);
  ledger.recordTokens(1, 1, 5);
  unsubscribe();
  ledger.reserve(2);
  assert.deepEqual(snapshots, [
    { total: 20, used: 0, launched: 1, maxAgents: 3 },
    { total: 20, used: 5, launched: 1, maxAgents: 3 },
  ]);
  assert.notEqual(snapshots[0], snapshots[1]);
});
