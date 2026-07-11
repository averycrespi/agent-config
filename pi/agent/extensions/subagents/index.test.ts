import { mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
import {
  buildSpawnAgentsParams,
  type AgentDefinition,
  type SpawnAgentItem,
} from "./types.ts";

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

test("validateSpawnAgentSpecs: reports all invalid agents before spawn", async () => {
  const errors = await validateSpawnAgentSpecs(
    [
      { agent: "explorer", intent: "   ", prompt: "Inspect files" },
      { agent: "missing", intent: "reviewer", prompt: "Review change" },
    ],
    new Map([["explorer", agent("explorer", "Read-only research")]]),
    process.cwd(),
  );

  assert.deepEqual(errors, [
    "agents[0].intent is required",
    'agents[1].agent "missing" is not a known agent type',
  ]);
});

test("validateSpawnAgentSpecs: accepts known agents with non-empty intents", async () => {
  const errors = await validateSpawnAgentSpecs(
    [{ agent: "explorer", intent: " inspect ", prompt: "Inspect files" }],
    new Map([["explorer", agent("explorer", "Read-only research")]]),
    process.cwd(),
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

test("validateSpawnAgentSpecs collects thinking, file, and schema errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagent-validation-"));
  const directory = join(root, "directory");
  const unreadable = join(root, "unreadable.txt");
  try {
    await mkdir(directory);
    await writeFile(unreadable, "secret");
    await chmod(unreadable, 0o000);
    const errors = await validateSpawnAgentSpecs(
      [
        {
          agent: "explorer",
          intent: "validate",
          prompt: "inspect",
          thinking: "extreme",
          files: ["", "missing.txt", directory, unreadable],
          output_schema: { type: ["string", "null"], minimum: 1 },
        } as any,
      ],
      new Map([["explorer", agent("explorer", "Read-only research")]]),
      root,
    );
    const joined = errors.join("\n");
    assert.match(joined, /agents\[0\]\.thinking/);
    assert.match(joined, /agents\[0\]\.files\[0\].*non-empty/);
    assert.match(joined, /agents\[0\]\.files\[1\].*readable regular file/);
    assert.match(joined, /agents\[0\]\.files\[2\].*regular file/);
    assert.match(joined, /agents\[0\]\.files\[3\].*readable regular file/);
    assert.match(joined, /agents\[0\]\.output_schema\.type/);
    assert.match(joined, /agents\[0\]\.output_schema\.minimum/);
  } finally {
    await chmod(unreadable, 0o600).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("validateSpawnAgentSpecs accepts relative, absolute, and symlinked readable files", async () => {
  const root = await mkdtemp(join(tmpdir(), "subagent-files-"));
  const relative = "relative.txt";
  const absolute = join(root, "absolute.txt");
  const link = join(root, "link.txt");
  try {
    await writeFile(join(root, relative), "relative");
    await writeFile(absolute, "absolute");
    await symlink(absolute, link);
    const errors = await validateSpawnAgentSpecs(
      [
        {
          agent: "explorer",
          intent: "files",
          prompt: "inspect",
          files: [relative, absolute, link],
          output_schema: { type: "object", properties: {} },
        } as any,
      ],
      new Map([["explorer", agent("explorer", "Read-only research")]]),
      root,
    );
    assert.deepEqual(errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateSpawnAgentSpecs rejects non-object output schemas", async () => {
  const errors = await validateSpawnAgentSpecs(
    [
      {
        agent: "explorer",
        intent: "schema",
        prompt: "inspect",
        output_schema: null,
      } as any,
    ],
    new Map([["explorer", agent("explorer", "Read-only research")]]),
    process.cwd(),
  );
  assert.match(
    errors.join("\n"),
    /agents\[0\]\.output_schema must be an object/,
  );
});

test("spawn_agents schema exposes controlled item options but not model", () => {
  const schema = buildSpawnAgentsParams("agent") as any;
  const itemProperties = schema.properties.agents.items.properties;
  assert.ok(itemProperties.thinking);
  assert.ok(itemProperties.files);
  assert.ok(itemProperties.output_schema);
  assert.equal(itemProperties.model, undefined);
  assert.match(
    itemProperties.files.description,
    /selected model.*retained logs/i,
  );
});

test("runParallelSpawn passes thinking, files, and output schema to the engine", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "subagent-pass-through-"));
  const file = join(root, "context.txt");
  let invocation: any;
  const stub = mock.method(_spawnSubagent, "fn", async (value: any) => {
    invocation = value;
    return successfulOutcome("done");
  });
  t.after(async () => {
    stub.mock.restore();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(file, "context");
  const explorer = agent("explorer", "Read-only research");
  explorer.thinking = "low";

  await runParallelSpawn(
    spawnPi(),
    [
      {
        agent: "explorer",
        intent: "options",
        prompt: "inspect",
        thinking: "xhigh",
        files: [file],
        output_schema: { type: "string" },
      } as any,
    ],
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(1),
  );

  assert.equal(invocation.thinking, "xhigh");
  assert.deepEqual(invocation.files, [file]);
  assert.deepEqual(invocation.output, { schema: { type: "string" } });
});

test("thinking omission preserves agent and parent fallbacks", async (t) => {
  const invocations: any[] = [];
  const stub = mock.method(_spawnSubagent, "fn", async (value: any) => {
    invocations.push(value);
    return successfulOutcome("done");
  });
  t.after(() => stub.mock.restore());
  const defined = agent("defined", "Defined thinking");
  defined.thinking = "high";
  const inherited = agent("inherited", "Parent thinking");

  await runParallelSpawn(
    { getThinkingLevel: () => "medium" } as any,
    [
      { agent: "defined", intent: "defined", prompt: "one" },
      { agent: "inherited", intent: "inherited", prompt: "two" },
    ],
    new Map([
      [defined.name, defined],
      [inherited.name, inherited],
    ]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(2),
  );

  assert.equal(invocations[0].thinking, "high");
  assert.equal(invocations[1].thinking, "medium");
});

test("unsupported output schema rejects the whole batch before spawn", async (t) => {
  const stub = mock.method(_spawnSubagent, "fn", async () =>
    successfulOutcome("unexpected"),
  );
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const result = await runParallelSpawn(
    spawnPi(),
    [
      { agent: "explorer", intent: "valid", prompt: "one" },
      {
        agent: "explorer",
        intent: "invalid",
        prompt: "two",
        output_schema: {
          anyOf: [{ type: "string" }],
          type: ["string", "null"],
        },
      } as any,
    ],
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(2),
  );
  assert.equal(stub.mock.callCount(), 0);
  assert.equal(result.details.validationError, true);
  assert.match(result.content[0]!.text, /agents\[1\]\.output_schema\.anyOf/);
  assert.match(result.content[0]!.text, /agents\[1\]\.output_schema\.type/);
});

test("structured successes render JSON and preserve null in envelopes", async (t) => {
  const outcomes = [
    {
      ...successfulOutcome("diagnostic prose"),
      structured: { ok: true, value: { answer: 42 } },
    },
    {
      ...successfulOutcome("diagnostic null"),
      structured: { ok: true, value: null },
    },
  ];
  const stub = mock.method(_spawnSubagent, "fn", async () => outcomes.shift()!);
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const result = await runParallelSpawn(
    spawnPi(),
    [
      {
        agent: "explorer",
        intent: "object",
        prompt: "one",
        output_schema: { type: "object", properties: {} },
      },
      {
        agent: "explorer",
        intent: "null",
        prompt: "two",
        output_schema: { type: "null" },
      },
    ],
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(2),
  );

  assert.match(result.content[0]!.text, /```json\n\{\n  "answer": 42\n\}\n```/);
  assert.match(result.content[0]!.text, /```json\nnull\n```/);
  assert.deepEqual(result.details.structured, [
    { requested: true, ok: true, value: { answer: 42 } },
    { requested: true, ok: true, value: null },
  ]);
  assert.equal(result.details.failed, 0);
  assert.equal(result.details.allOk, true);
});

test("structured contract failures with zero exit codes fail the aggregate", async (t) => {
  const codes = [
    "structured_output_not_called",
    "structured_output_malformed",
    "structured_output_incomplete",
    "structured_output_invalid",
    "structured_output_tool_error",
  ];
  const stub = mock.method(_spawnSubagent, "fn", async () => {
    const code = codes.shift()!;
    return {
      ok: false,
      aborted: false,
      stdout: "diagnostic",
      stderr: "",
      exitCode: 0,
      signal: null,
      errorMessage: `structured failure: ${code}`,
      structured: { ok: false, code, errors: [code] },
    } as any;
  });
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const result = await runParallelSpawn(
    spawnPi(),
    Array.from({ length: 5 }, (_, index) => ({
      agent: "explorer",
      intent: `failure ${index}`,
      prompt: `failure ${index}`,
      output_schema: { type: "string" },
    })),
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(5),
  );

  assert.equal(result.details.failed, 5);
  assert.equal(result.details.allOk, false);
  const structured = result.details.structured as Array<any>;
  assert.equal(structured.length, 5);
  assert.ok(
    structured.every(
      (entry) =>
        entry.requested === true &&
        entry.ok === false &&
        /structured failure/.test(entry.error),
    ),
  );
});

test("mixed prose and structured results retain input-aligned envelopes", async (t) => {
  const outcomes = [
    successfulOutcome("plain result"),
    {
      ...successfulOutcome("structured diagnostic"),
      structured: { ok: true, value: "value" },
    },
    {
      ok: false,
      aborted: false,
      stdout: "partial",
      stderr: "",
      exitCode: 0,
      signal: null,
      errorMessage: "contract failed",
      structured: { ok: false, errors: ["contract failed"] },
    },
  ];
  const stub = mock.method(_spawnSubagent, "fn", async () => outcomes.shift()!);
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const result = await runParallelSpawn(
    spawnPi(),
    [
      { agent: "explorer", intent: "prose", prompt: "one" },
      {
        agent: "explorer",
        intent: "success",
        prompt: "two",
        output_schema: { type: "string" },
      },
      {
        agent: "explorer",
        intent: "failure",
        prompt: "three",
        output_schema: { type: "string" },
      },
    ],
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(3),
  );

  assert.match(result.content[0]!.text, /## explorer · prose\n\nplain result/);
  assert.deepEqual(result.details.structured, [
    { requested: false },
    { requested: true, ok: true, value: "value" },
    { requested: true, ok: false, error: "contract failed" },
  ]);
  assert.equal(result.details.failed, 1);
});

test("prose-only batches preserve section bodies and omit structured details", async (t) => {
  const stub = mock.method(_spawnSubagent, "fn", async () =>
    successfulOutcome("unchanged prose"),
  );
  t.after(() => stub.mock.restore());
  const explorer = agent("explorer", "Read-only research");
  const result = await runParallelSpawn(
    spawnPi(),
    [{ agent: "explorer", intent: "prose", prompt: "one" }],
    new Map([[explorer.name, explorer]]),
    spawnContext(),
    "call",
    undefined,
    createConcurrencyGate(1),
  );

  assert.equal(
    result.content[0]!.text,
    "## explorer · prose\n\nunchanged prose",
  );
  assert.equal("structured" in result.details, false);
});

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
    specs(4).map((spec, index) =>
      index === 3 ? { ...spec, output_schema: { type: "string" } } : spec,
    ),
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
  assert.equal(result.details.failed, 3);
  assert.equal(result.details.allOk, false);
  assert.deepEqual((result.details.structured as Array<any>)[3], {
    requested: true,
    ok: false,
    error: "Subagent cancelled before launch",
  });
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
