import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { THRESHOLD_CHARS } from "../_shared/spillover.ts";
import {
  buildAgentDescription,
  _spawnSubagent,
  buildDelegationGuidance,
  normalizeIntent,
  runParallelSpawn,
  spillSubagentOutput,
  validateSpawnAgentSpecs,
} from "./index.ts";
import { createConcurrencyGate } from "./pool.ts";
import type { AgentDefinition, SpawnAgentItem } from "./types.ts";

// ─── normalizeIntent ─────────────────────────────────────────────────────────

test("normalizeIntent: trims surrounding whitespace", () => {
  assert.equal(normalizeIntent("  find auth  "), "find auth");
});

test("normalizeIntent: throws on empty string", () => {
  assert.throws(() => normalizeIntent(""), /intent is required/);
});

test("normalizeIntent: throws on whitespace-only string", () => {
  assert.throws(() => normalizeIntent("   \t\n  "), /intent is required/);
});

// ─── buildAgentDescription ───────────────────────────────────────────────────

function agent(name: string, description: string): AgentDefinition {
  return {
    name,
    description,
    tools: [],
    extensions: [],
    systemPrompt: "x",
    disableSkills: false,
    disablePromptTemplates: false,
  };
}

test("buildAgentDescription: empty list returns no-agents-loaded message", () => {
  const text = buildAgentDescription([]);
  assert.match(text, /No agents are currently loaded/);
});

test("buildAgentDescription: non-empty list enumerates name and description", () => {
  const text = buildAgentDescription([
    agent("explorer", "Read-only research"),
    agent("code", "Full write access"),
  ]);
  assert.match(text, /Agent type\. Choose based on the task:/);
  assert.match(text, /- explorer: Read-only research/);
  assert.match(text, /- code: Full write access/);
});

// ─── buildDelegationGuidance ────────────────────────────────────────────────

test("buildDelegationGuidance: includes triggers, exclusions, and agent list", () => {
  const text = buildDelegationGuidance([
    agent("explorer", "Read-only repo exploration"),
    agent("reviewer", "Read-only review"),
  ]);

  assert.match(text, /Use spawn_agents proactively/);
  assert.match(text, /Delegate when:/);
  assert.match(text, /Do not delegate when:/);
  assert.match(text, /editing files/);
  assert.match(text, /explorer: Read-only repo exploration/);
  assert.match(text, /reviewer: Read-only review/);
});

// ─── validateSpawnAgentSpecs ────────────────────────────────────────────────

test("validateSpawnAgentSpecs: reports all invalid agents before spawn", () => {
  const errors = validateSpawnAgentSpecs(
    [
      { agent: "explorer", intent: "   ", prompt: "Inspect files" },
      { agent: "missing", intent: "reviewer", prompt: "Review change" },
    ],
    new Map([["explorer", agent("explorer", "Read-only research")]]),
  );

  assert.deepEqual(errors, [
    "agents[0].intent is required",
    'agents[1].agent "missing" is not a known agent type',
  ]);
});

test("validateSpawnAgentSpecs: accepts known agents with non-empty intents", () => {
  const errors = validateSpawnAgentSpecs(
    [{ agent: "explorer", intent: " inspect ", prompt: "Inspect files" }],
    new Map([["explorer", agent("explorer", "Read-only research")]]),
  );

  assert.deepEqual(errors, []);
});

// ─── spillSubagentOutput ────────────────────────────────────────────────────

function spawnContext(signal?: AbortSignal) {
  return {
    cwd: process.cwd(),
    signal,
    model: { provider: "test", id: "model" },
    sessionManager: { getSessionFile: () => undefined },
    hasUI: false,
    ui: { setStatus() {}, setWidget() {} },
  };
}

function spawnPi() {
  return { getThinkingLevel: () => "off" } as any;
}

function specs(count: number): SpawnAgentItem[] {
  return Array.from({ length: count }, (_, index) => ({
    agent: "explorer",
    intent: `item ${index}`,
    prompt: `prompt ${index}`,
  }));
}

function successfulOutcome(stdout: string) {
  return {
    ok: true,
    aborted: false,
    stdout,
    stderr: "",
    exitCode: 0,
    signal: null,
  } as const;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("runParallelSpawn rejects 17 items atomically", async (t) => {
  const stub = mock.method(_spawnSubagent, "fn", async () =>
    successfulOutcome("unexpected"),
  );
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");

  const result = await runParallelSpawn(
    spawnPi(),
    specs(17),
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(4),
  );

  assert.equal(result.details.validationError, true);
  assert.match(result.content[0]!.text, /at most 16 agents/i);
  assert.equal(stub.mock.callCount(), 0);
});

test("runParallelSpawn bounds launches and preserves input result order", async (t) => {
  const pending = Array.from({ length: 6 }, () =>
    deferred<ReturnType<typeof successfulOutcome>>(),
  );
  const launched: number[] = [];
  const stub = mock.method(_spawnSubagent, "fn", (invocation: any) => {
    const index = Number(invocation.prompt.split(" ").at(-1));
    launched.push(index);
    return pending[index]!.promise;
  });
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");

  const resultPromise = runParallelSpawn(
    spawnPi(),
    specs(6),
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(4),
  );
  await flush();
  assert.deepEqual(launched, [0, 1, 2, 3]);

  for (const index of [3, 1, 0, 2]) {
    pending[index]!.resolve(successfulOutcome(`result ${index}`));
    await flush();
  }
  assert.deepEqual(launched, [0, 1, 2, 3, 4, 5]);
  pending[5]!.resolve(successfulOutcome("result 5"));
  pending[4]!.resolve(successfulOutcome("result 4"));

  const result = await resultPromise;
  const combined = result.content[0]!.text;
  for (let index = 0; index < 5; index += 1) {
    assert.ok(
      combined.indexOf(`result ${index}`) <
        combined.indexOf(`result ${index + 1}`),
    );
  }
});

test("overlapping runParallelSpawn calls share one concurrency gate", async (t) => {
  const pending: Array<
    ReturnType<typeof deferred<ReturnType<typeof successfulOutcome>>>
  > = [];
  let active = 0;
  let maxActive = 0;
  const stub = mock.method(_spawnSubagent, "fn", async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const item = deferred<ReturnType<typeof successfulOutcome>>();
    pending.push(item);
    const outcome = await item.promise;
    active -= 1;
    return outcome;
  });
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const agentMap = new Map([[explorer.name, explorer]]);
  const gate = createConcurrencyGate(2);

  const first = runParallelSpawn(
    spawnPi(),
    specs(2),
    agentMap,
    spawnContext(),
    "first",
    undefined,
    gate,
  );
  const second = runParallelSpawn(
    spawnPi(),
    specs(2),
    agentMap,
    spawnContext(),
    "second",
    undefined,
    gate,
  );
  await flush();
  assert.equal(pending.length, 2);
  pending[0]!.resolve(successfulOutcome("done"));
  await flush();
  assert.equal(pending.length, 3);
  pending[1]!.resolve(successfulOutcome("done"));
  await flush();
  pending[2]!.resolve(successfulOutcome("done"));
  await flush();
  pending[3]!.resolve(successfulOutcome("done"));
  await Promise.all([first, second]);
  assert.equal(maxActive, 2);
});

test("cancellation preserves completed output and aborts queued items without launching them", async (t) => {
  const controller = new AbortController();
  const first = deferred<ReturnType<typeof successfulOutcome>>();
  let launches = 0;
  const stub = mock.method(_spawnSubagent, "fn", (invocation: any) => {
    launches += 1;
    if (launches === 1) return first.promise;
    return new Promise((resolve) => {
      invocation.signal.addEventListener(
        "abort",
        () =>
          resolve({
            ok: false,
            aborted: true,
            stdout: "",
            stderr: "cancelled",
            exitCode: null,
            signal: "SIGTERM",
            errorMessage: "Subagent aborted",
          }),
        { once: true },
      );
    });
  });
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const updates: any[] = [];

  const resultPromise = runParallelSpawn(
    spawnPi(),
    specs(4),
    new Map([[explorer.name, explorer]]),
    spawnContext(controller.signal),
    "call",
    (update) => updates.push(update),
    createConcurrencyGate(1),
  );
  await flush();
  assert.ok(
    (updates[0].details.agents as Array<any>).every(
      (state) => state.phase === "queued" && state.resolved !== true,
    ),
  );
  first.resolve(successfulOutcome("completed output"));
  await flush();
  assert.equal(launches, 2);
  controller.abort();
  const result = await resultPromise;

  assert.equal(launches, 2);
  assert.match(result.content[0]!.text, /completed output/);
  const states = result.details.agents as Array<any>;
  assert.equal(states[0].phase, "done");
  assert.equal(states[1].phase, "aborted");
  assert.equal(states[2].phase, "aborted");
  assert.equal(states[3].phase, "aborted");
  assert.ok(states.slice(2).every((state) => state.resolved === true));
  assert.ok(
    updates.some((update) =>
      (update.details.agents as Array<any>)
        .slice(2)
        .every((state) => state.phase === "aborted" && state.resolved === true),
    ),
  );
});

test("cancellation after admission but before launch does not spawn", async (t) => {
  const controller = new AbortController();
  let released = false;
  const stub = mock.method(_spawnSubagent, "fn", async () =>
    successfulOutcome("unexpected"),
  );
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");

  const result = await runParallelSpawn(
    spawnPi(),
    specs(1),
    new Map([[explorer.name, explorer]]),
    spawnContext(controller.signal),
    "call",
    undefined,
    {
      acquire: async () => {
        controller.abort();
        return () => {
          released = true;
        };
      },
      setLimit() {},
    },
  );

  assert.equal(stub.mock.callCount(), 0);
  assert.equal(released, true);
  assert.equal((result.details.agents as Array<any>)[0].phase, "aborted");
});

test("gate acquisition defects reject instead of becoming cancellation", async (t) => {
  const stub = mock.method(_spawnSubagent, "fn", async () =>
    successfulOutcome("unexpected"),
  );
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const defect = new Error("scheduler defect");

  await assert.rejects(
    runParallelSpawn(
      spawnPi(),
      specs(1),
      new Map([[explorer.name, explorer]]),
      spawnContext(),
      "call",
      undefined,
      {
        acquire: async () => {
          throw defect;
        },
        setLimit() {},
      },
    ),
    defect,
  );
  assert.equal(stub.mock.callCount(), 0);
});

// ─── spillSubagentOutput ────────────────────────────────────────────────────

test("spillSubagentOutput spills oversized subagent output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagent-spill-test-"));
  try {
    const largeOutput = "subagent output\n".repeat(
      Math.ceil((THRESHOLD_CHARS + 1) / "subagent output\n".length),
    );

    const result = await spillSubagentOutput(
      [{ type: "text", text: largeOutput }],
      "call/subagent?1",
      dir,
    );

    assert.equal(result.details.outputSpilled, true);
    assert.equal(result.details.originalSize, largeOutput.length);
    assert.match(result.content[0]!.text, /<persisted-output>/);
    assert.match(result.content[0]!.text, /call_subagent_1\.txt/);
    const spillFile = result.details.spillFile as string;
    assert.equal(await readFile(spillFile, "utf8"), largeOutput);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
