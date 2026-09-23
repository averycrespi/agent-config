import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { BackgroundEngine, type Host } from "./engine.ts";
import { registration, type Receipt } from "./contract.ts";
import { Bridge, subscribeEvents } from "./session-transport.ts";
import { temporaryRoot, pause } from "./test-support.ts";
import askUser from "../ask-user/index.ts";

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await pause(10);
  }
  assert.ok(predicate(), "bounded fixture condition");
}

test(
  "early gate: five owners, two pending questions, one shared wake, result and recovery",
  { timeout: 10000 },
  async (t) => {
    const tmp = temporaryRoot();
    const workers = Array.from(
      { length: 5 },
      () => new Bridge(tmp.root, randomUUID()),
    );
    let busy = true;
    const handed: Receipt[] = [];
    const retained = new Map<string, Receipt>();
    const host: Host = {
      idle: () => !busy,
      changed() {},
      persist: (r) => {
        retained.set(r.id, structuredClone(r));
      },
      handoff: (r) => {
        handed.push(r);
        busy = true;
      },
      evaluate: async () =>
        assert.fail("event-only observation needs no evaluator"),
      subscribe: async (selection, _reg, signal, deadline, emit, lost) => {
        const sub = await subscribeEvents(
          tmp.root,
          String(selection.args[0]),
          ["agent_settled"],
          deadline - Date.now(),
          (n) => emit({ ...n }),
          lost,
          signal,
        );
        return {
          coverage: { ...sub.target, startedAt: sub.startedAt },
          close: sub.close,
        };
      },
    };
    const engine = new BackgroundEngine(host);
    t.after(() => {
      engine.close(false);
      workers.forEach((w) => w.close());
      tmp.remove();
    });
    for (const worker of workers) await worker.start();
    const observe = (members: Bridge[]) =>
      engine.start(
        registration({
          name: "shared fixture",
          message: "Reconcile every covered checkpoint",
          providers: ["sessions"],
          cycle_timeout_ms: 5000,
          lifetime_ms: 6000,
          max_wakes: 1,
          events: members.map((w) => ({
            provider: "sessions",
            event: "lifecycle",
            args: [w.target.incarnation, ["agent_settled"]],
          })),
        }),
      );
    const first = await observe(workers.slice(0, 4));
    const second = await observe(workers.slice(4));
    assert.equal(engine.list().length, 2);
    assert.equal(first.coverage.length + second.coverage.length, 5);

    let tool: any;
    const old = process.env.PI_ASK_USER_MODE;
    process.env.PI_ASK_USER_MODE = "parent";
    try {
      askUser({
        events: createEventBus(),
        registerTool: (value: any) => {
          tool = value;
        },
      } as any);
    } finally {
      if (old === undefined) delete process.env.PI_ASK_USER_MODE;
      else process.env.PI_ASK_USER_MODE = old;
    }
    const paths = workers.map((_, i) => join(tmp.root, `child-${i}.json`));
    const save = (i: number, disposition: string, reference: string) =>
      writeFileSync(
        paths[i],
        JSON.stringify({
          assignment: `task-${i}`,
          revision: 1,
          ...workers[i].target,
          disposition,
          reference,
          furtherWrites: disposition !== "result offered",
          executionBudget: 7,
          ciBudget: 3,
        }),
      );
    for (let i = 0; i < 2; i++) {
      const result = await tool.execute(
        "question",
        { question: "Choose scope", options: [{ label: "A" }, { label: "B" }] },
        undefined,
        undefined,
        {
          get ui() {
            return assert.fail("questions must not open modal UI");
          },
        },
      );
      assert.equal(result.details.answerSupplied, false);
      save(i, "decision needed", result.details.requestId);
    }
    save(2, "result offered", "revision-bound-evidence");
    save(3, "working", "child-checkpoint");
    save(4, "working", "child-checkpoint");
    // One-shot coalescing may discard B/C signals: durable state owns their facts.
    for (const worker of workers.slice(0, 3))
      worker.publish("agent_settled", {});
    await until(() => engine.get(first.id)?.status === "finished");
    busy = false;
    engine.settled();
    await until(() => handed.length === 1);
    const read = () => paths.map((p) => JSON.parse(readFileSync(p, "utf8")));
    const state = read();
    assert.deepEqual(
      state.map((s) => s.disposition),
      [
        "decision needed",
        "decision needed",
        "result offered",
        "working",
        "working",
      ],
    );
    assert.notEqual(state[0].reference, state[1].reference);
    assert.equal(
      engine.get(second.id)?.status,
      "active",
      "unrelated group retains coverage",
    );
    assert.equal(
      [...retained.values()].reduce((sum, r) => sum + r.wakes, 0),
      1,
      "one parent attempt, not five child charges",
    );
    assert.ok(state.every((s) => s.executionBudget === 7 && s.ciBudget === 3));

    // Replacement first retains receipts and all checkpoint identities; no prompt replay.
    engine.close(true);
    assert.equal(engine.get(second.id)?.status, "invalidated");
    assert.deepEqual(
      read(),
      state,
      "questions/results survive coordinator loss without progress transcription",
    );
    assert.equal(handed.length, 1);
    const recovered = new BackgroundEngine({
      ...host,
      subscribe: async () => assert.fail("restoration must not resubscribe"),
      handoff: () => assert.fail("restoration must not replay attention"),
    });
    recovered.restore([...retained.values()]);
    assert.equal(recovered.list().length, 2);
    assert.ok(recovered.list().every((r) => r.status !== "active"));
    recovered.close(false);
  },
);

test(
  "early gate: membership gap, group disconnect, exact incarnation and capacity",
  { timeout: 10000 },
  async (t) => {
    const tmp = temporaryRoot();
    const workers = Array.from(
      { length: 5 },
      () => new Bridge(tmp.root, randomUUID()),
    );
    const engine = new BackgroundEngine({
      idle: () => false,
      changed() {},
      persist() {},
      handoff: () => assert.fail("busy"),
      evaluate: async () => assert.fail("no evaluator"),
      subscribe: async (s, _r, signal, deadline, emit, lost) => {
        const sub = await subscribeEvents(
          tmp.root,
          String(s.args[0]),
          ["agent_settled"],
          deadline - Date.now(),
          (n) => emit({ ...n }),
          lost,
          signal,
        );
        return {
          coverage: { ...sub.target, startedAt: sub.startedAt },
          close: sub.close,
        };
      },
    });
    t.after(() => {
      engine.close(false);
      workers.forEach((w) => w.close());
      tmp.remove();
    });
    for (const worker of workers) await worker.start();
    const observe = (members: Bridge[]) =>
      engine.start(
        registration({
          name: "membership",
          message: "Reconcile group",
          providers: ["sessions"],
          cycle_timeout_ms: 5000,
          lifetime_ms: 6000,
          max_wakes: 1,
          events: members.map((w) => ({
            provider: "sessions",
            event: "lifecycle",
            args: [w.target.incarnation, ["agent_settled"]],
          })),
        }),
      );
    workers[0].publish("agent_settled", {});
    const group = await observe(workers.slice(0, 4));
    const other = await observe(workers.slice(4));
    assert.equal(
      engine.get(group.id)?.status,
      "active",
      "pre-registration events are not replayed",
    );
    workers[1].close();
    await until(() => engine.get(group.id)?.status === "finished");
    assert.equal(engine.get(group.id)?.attention?.reason, "coverage_failure");
    assert.equal(
      engine.get(group.id)?.coverage.length,
      4,
      "entire membership needs reconciliation",
    );
    assert.equal(engine.get(other.id)?.status, "active");
    engine.cancel(group.id);
    const old = workers[1];
    workers[1] = new Bridge(tmp.root, old.target.sessionId);
    await workers[1].start();
    assert.notEqual(old.target.incarnation, workers[1].target.incarnation);
    await assert.rejects(observe([old]));
    const replacement = await observe(workers.slice(0, 4));
    assert.equal(replacement.coverage.length, 4);
    engine.cancel(replacement.id);
    workers[0].publish("agent_settled", {}); // replacement gap is not an inbox
    const joined = await observe([workers[0], workers[2], workers[3]]);
    assert.equal(engine.get(joined.id)?.status, "active");
    await observe([workers[1]]);
    await observe([workers[2]]);
    await assert.rejects(observe([workers[3]]), /capacity/);
    assert.equal(
      engine.get(other.id)?.status,
      "active",
      "capacity failure does not claim new coverage or stop unrelated jobs",
    );
  },
);
