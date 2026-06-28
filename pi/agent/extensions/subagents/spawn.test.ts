import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  POST_AGENT_END_GRACE_MS,
  buildArgs,
  formatSpawnFailure,
  spawnSubagent,
  _spawn,
  _timers,
  type SpawnOutcome,
} from "./spawn.ts";
import { _loggingFs } from "../_shared/logging.ts";
import { THRESHOLD_CHARS } from "../_shared/spillover.ts";

function baseOutcome(overrides: Partial<SpawnOutcome> = {}): SpawnOutcome {
  return {
    ok: false,
    aborted: false,
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
    ...overrides,
  };
}

// ─── formatSpawnFailure ──────────────────────────────────────────────────────

test("formatSpawnFailure: aborted outcome surfaces aborted message", () => {
  const text = formatSpawnFailure(baseOutcome({ aborted: true }));
  assert.match(text, /aborted/);
});

test("formatSpawnFailure: includes log file when present", () => {
  const text = formatSpawnFailure(
    baseOutcome({ aborted: true, logFile: "/tmp/x.log" }),
  );
  assert.match(text, /\/tmp\/x\.log/);
});

test("formatSpawnFailure: includes errorMessage, exit code, stderr, stdout", () => {
  const text = formatSpawnFailure(
    baseOutcome({
      errorMessage: "subagent exited with code 2",
      exitCode: 2,
      stderr: "boom\n",
      stdout: "partial output\n",
    }),
  );
  assert.match(text, /subagent exited with code 2/);
  assert.match(text, /Exit code: 2/);
  assert.match(text, /boom/);
  assert.match(text, /partial output/);
});

test("formatSpawnFailure: omits empty fields", () => {
  const text = formatSpawnFailure(baseOutcome({ errorMessage: "oops" }));
  assert.match(text, /oops/);
  assert.doesNotMatch(text, /Exit code/);
  assert.doesNotMatch(text, /stderr:/);
  assert.doesNotMatch(text, /stdout:/);
});

test("formatSpawnFailure: falls back to generic message when errorMessage missing", () => {
  const text = formatSpawnFailure(baseOutcome({}));
  assert.match(text, /subagent failed/);
});

// ─── buildArgs ───────────────────────────────────────────────────────────────

test("buildArgs: --no-session when inheritSession=none", () => {
  const args = buildArgs({
    prompt: "hi",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
  });
  assert.ok(args.includes("--no-session"));
  assert.ok(!args.includes("--fork"));
});

test("buildArgs: --fork <file> when inheritSession=fork", () => {
  const args = buildArgs({
    prompt: "hi",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "fork",
    parentSessionFile: "/tmp/session.json",
  });
  const forkIdx = args.indexOf("--fork");
  assert.ok(forkIdx >= 0);
  assert.equal(args[forkIdx + 1], "/tmp/session.json");
  assert.ok(!args.includes("--no-session"));
});

test("buildArgs: inheritSession=fork without parentSessionFile throws", () => {
  assert.throws(
    () =>
      buildArgs({
        prompt: "hi",
        tools: [],
        extensions: [],
        files: [],
        inheritSession: "fork",
      }),
    /parent session file/,
  );
});

test("buildArgs: empty tools → --no-tools", () => {
  const args = buildArgs({
    prompt: "hi",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
  });
  assert.ok(args.includes("--no-tools"));
  assert.ok(!args.includes("--tools"));
});

test("buildArgs: tools joined and deduplicated", () => {
  const args = buildArgs({
    prompt: "hi",
    tools: ["read", "bash", "read"],
    extensions: [],
    files: [],
    inheritSession: "none",
  });
  const toolsIdx = args.indexOf("--tools");
  assert.ok(toolsIdx >= 0);
  assert.equal(args[toolsIdx + 1], "read,bash");
});

test("buildArgs: each extension emits a -e flag", () => {
  const args = buildArgs({
    prompt: "hi",
    tools: [],
    extensions: ["/a/one", "/b/two"],
    files: [],
    inheritSession: "none",
  });
  assert.ok(args.includes("--no-extensions"));
  const eFlags = args
    .map((a, i) => (a === "-e" ? args[i + 1] : null))
    .filter((x): x is string => x !== null);
  assert.deepEqual(eFlags, ["/a/one", "/b/two"]);
});

test("buildArgs: files emitted as @path before prompt", () => {
  const args = buildArgs({
    prompt: "do-thing",
    tools: [],
    extensions: [],
    files: ["foo.md", "bar.md"],
    inheritSession: "none",
  });
  const fooIdx = args.indexOf("@foo.md");
  const barIdx = args.indexOf("@bar.md");
  const promptIdx = args.indexOf("do-thing");
  assert.ok(fooIdx >= 0 && barIdx >= 0);
  assert.ok(fooIdx < promptIdx && barIdx < promptIdx);
});

test("buildArgs: prompt is the final argument", () => {
  const args = buildArgs({
    prompt: "the-prompt",
    tools: ["read"],
    extensions: ["/ext"],
    files: ["file.md"],
    inheritSession: "none",
  });
  assert.equal(args[args.length - 1], "the-prompt");
});

test("buildArgs: model and thinking flags only present when provided", () => {
  const withFlags = buildArgs({
    prompt: "p",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
    model: "openai/gpt-5",
    thinking: "high",
  });
  const modelIdx = withFlags.indexOf("--model");
  const thinkIdx = withFlags.indexOf("--thinking");
  assert.equal(withFlags[modelIdx + 1], "openai/gpt-5");
  assert.equal(withFlags[thinkIdx + 1], "high");

  const noFlags = buildArgs({
    prompt: "p",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
  });
  assert.ok(!noFlags.includes("--model"));
  assert.ok(!noFlags.includes("--thinking"));
});

test("buildArgs: --no-skills and --no-prompt-templates gated on booleans", () => {
  const on = buildArgs({
    prompt: "p",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
    disableSkills: true,
    disablePromptTemplates: true,
  });
  assert.ok(on.includes("--no-skills"));
  assert.ok(on.includes("--no-prompt-templates"));

  const off = buildArgs({
    prompt: "p",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
  });
  assert.ok(!off.includes("--no-skills"));
  assert.ok(!off.includes("--no-prompt-templates"));
});

test("buildArgs: systemPrompt only appended when trimmed non-empty", () => {
  const blank = buildArgs({
    prompt: "p",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
    systemPrompt: "   \n  ",
  });
  assert.ok(!blank.includes("--append-system-prompt"));

  const real = buildArgs({
    prompt: "p",
    tools: [],
    extensions: [],
    files: [],
    inheritSession: "none",
    systemPrompt: "  you are helpful  ",
  });
  const idx = real.indexOf("--append-system-prompt");
  assert.ok(idx >= 0);
  assert.equal(real[idx + 1], "you are helpful");
});

// ─── spawnSubagent (pre-spawn guards) ─────────────────────────────────────────

test("spawnSubagent: depth-cap short-circuits without spawning", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "5";
  try {
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
    });
    assert.equal(result.ok, false);
    assert.match(result.errorMessage ?? "", /depth limit/);
  } finally {
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
  }
});

test("spawnSubagent: unresolved extensionAllowlist returns error without spawning", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "0";
  const prevDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = "/nonexistent-agent-dir";
  try {
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: ["definitely-not-here"],
      cwd: "/nonexistent-cwd",
    });
    assert.equal(result.ok, false);
    assert.match(
      result.errorMessage ?? "",
      /no matching extensions found for: definitely-not-here/,
    );
  } finally {
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
    if (prevDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevDir;
  }
});

test("spawnSubagent: aborted signal before spawn returns error without running", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "0";
  try {
    const controller = new AbortController();
    controller.abort();
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
      signal: controller.signal,
    });
    assert.equal(result.ok, false);
    assert.equal(result.aborted, true);
  } finally {
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
  }
});

// ─── spawnSubagent structured output ─────────────────────────────────────────

test("spawnSubagent: captures valid structured output from child tool result", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "0";
  let capturedArgs: string[] | undefined;
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  let capturedSchema: unknown;

  const spawnStub = mock.method(_spawn, "fn", (...args: unknown[]) => {
    capturedArgs = args[1] as string[];
    capturedEnv = (args[2] as { env?: NodeJS.ProcessEnv }).env;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};

    setImmediate(async () => {
      capturedSchema = JSON.parse(
        await readFile(capturedEnv!.PI_STRUCTURED_OUTPUT_SCHEMA_FILE!, "utf8"),
      );
      child.stdout.emit(
        "data",
        `${JSON.stringify({
          type: "tool_execution_end",
          toolName: "structured_output",
          isError: false,
          result: {
            details: {
              value: { files: ["src/auth.ts"] },
            },
          },
        })}\n${JSON.stringify({
          type: "message_end",
          message: { content: [{ type: "text", text: "captured" }] },
        })}\n`,
      );
      child.emit("close", 0, null);
    });

    return child;
  });

  try {
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
      output: {
        schema: {
          type: "object",
          required: ["files"],
          properties: {
            files: { type: "array", items: { type: "string" } },
          },
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.stdout, "captured");
    assert.deepEqual(result.structured, {
      ok: true,
      value: { files: ["src/auth.ts"] },
    });
    assert.ok(capturedArgs?.includes("-e"));
    const toolsIdx = capturedArgs?.indexOf("--tools") ?? -1;
    assert.ok(toolsIdx >= 0, "structured output keeps tools enabled");
    assert.match(capturedArgs?.[toolsIdx + 1] ?? "", /structured_output/);
    assert.ok(
      capturedArgs?.some((arg) => /structured-output$/.test(arg)),
      "generic structured-output extension is loaded",
    );
    assert.match(
      capturedEnv?.PI_STRUCTURED_OUTPUT_SCHEMA_FILE ?? "",
      /subagent-structured-output-.*schema\.json$/,
    );
    assert.equal(capturedEnv?.PI_STRUCTURED_OUTPUT_TERMINATE, "1");
    assert.deepEqual(capturedSchema, {
      type: "object",
      required: ["files"],
      properties: {
        files: { type: "array", items: { type: "string" } },
      },
    });
  } finally {
    spawnStub.mock.restore();
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
  }
});

test("spawnSubagent: requested structured output fails when child value is invalid", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "0";

  const spawnStub = mock.method(_spawn, "fn", () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};

    setImmediate(() => {
      child.stdout.emit(
        "data",
        `${JSON.stringify({
          type: "tool_execution_end",
          toolName: "structured_output",
          isError: false,
          result: { details: { value: { files: "not an array" } } },
        })}\n`,
      );
      child.emit("close", 0, null);
    });

    return child;
  });

  try {
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
      output: {
        schema: {
          type: "object",
          required: ["files"],
          properties: {
            files: { type: "array", items: { type: "string" } },
          },
        },
      },
    });

    assert.equal(result.ok, false);
    assert.match(
      result.errorMessage ?? "",
      /structured output validation failed/,
    );
    assert.equal(result.structured?.ok, false);
    assert.ok(result.structured?.errors?.length);
  } finally {
    spawnStub.mock.restore();
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
  }
});

// ─── spawnSubagent env merge ──────────────────────────────────────────────────

test("spawnSubagent env: options.env overrides process.env, PI_SUBAGENT_DEPTH always wins", async () => {
  const prevDepth = process.env.PI_SUBAGENT_DEPTH;
  const prevVar = process.env.MCP_BROKER_READONLY;

  process.env.PI_SUBAGENT_DEPTH = "0";
  process.env.MCP_BROKER_READONLY = "parent-value";

  let capturedEnv: NodeJS.ProcessEnv | undefined;

  const stub = mock.method(_spawn, "fn", (...args: unknown[]) => {
    const opts = args[2] as { env?: NodeJS.ProcessEnv };
    capturedEnv = opts?.env;

    // Return a minimal fake ChildProcess that immediately emits close(0).
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    // Emit close on the next tick so listeners are attached first.
    setImmediate(() => child.emit("close", 0, null));
    return child;
  });

  try {
    await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
      env: {
        MCP_BROKER_READONLY: "caller-value",
        // Attempt to override PI_SUBAGENT_DEPTH — must be ignored.
        PI_SUBAGENT_DEPTH: "99",
      },
    });

    assert.ok(capturedEnv !== undefined, "spawn was called");
    // options.env overrides process.env
    assert.equal(capturedEnv!.MCP_BROKER_READONLY, "caller-value");
    // PI_SUBAGENT_DEPTH must be the computed value (0 + 1 = 1), not caller's 99
    assert.equal(capturedEnv!.PI_SUBAGENT_DEPTH, "1");
  } finally {
    stub.mock.restore();
    if (prevDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prevDepth;
    if (prevVar === undefined) delete process.env.MCP_BROKER_READONLY;
    else process.env.MCP_BROKER_READONLY = prevVar;
  }
});

test("spawnSubagent env: omitting options.env passes process.env through unchanged", async () => {
  const prevDepth = process.env.PI_SUBAGENT_DEPTH;
  const prevVar = process.env.MCP_BROKER_READONLY;

  process.env.PI_SUBAGENT_DEPTH = "0";
  process.env.MCP_BROKER_READONLY = "parent-value";

  let capturedEnv: NodeJS.ProcessEnv | undefined;

  const stub = mock.method(_spawn, "fn", (...args: unknown[]) => {
    const opts = args[2] as { env?: NodeJS.ProcessEnv };
    capturedEnv = opts?.env;

    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    setImmediate(() => child.emit("close", 0, null));
    return child;
  });

  try {
    await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
    });

    assert.ok(capturedEnv !== undefined, "spawn was called");
    assert.equal(capturedEnv!.MCP_BROKER_READONLY, "parent-value");
    assert.equal(capturedEnv!.PI_SUBAGENT_DEPTH, "1");
  } finally {
    stub.mock.restore();
    if (prevDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prevDepth;
    if (prevVar === undefined) delete process.env.MCP_BROKER_READONLY;
    else process.env.MCP_BROKER_READONLY = prevVar;
  }
});

test("spawnSubagent: retained failure logs include raw output", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "0";
  const root = await mkdtemp(join(tmpdir(), "subagent-log-test-"));
  const tmpStub = mock.method(_loggingFs, "tmpdir", () => root);

  const spawnStub = mock.method(_spawn, "fn", () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};

    setImmediate(() => {
      child.stderr.emit("data", "token=super-secret\n");
      child.emit("close", 1, null);
    });

    return child;
  });

  try {
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
      logId: "secret-run",
    });

    assert.equal(result.ok, false);
    assert.match(result.logFile ?? "", /secret-run\.log$/);
    assert.equal(
      await readFile(result.logFile!, "utf8"),
      "$ pi --mode json -p --no-session --no-tools --no-extensions p\n\n[stderr] token=super-secret\n",
    );
  } finally {
    spawnStub.mock.restore();
    tmpStub.mock.restore();
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
  }
});

test("spawnSubagent: spills oversized final stdout", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "0";
  const largeOutput = "subagent output\n".repeat(
    Math.ceil((THRESHOLD_CHARS + 1) / "subagent output\n".length),
  );
  const expectedOutput = largeOutput.trim();
  const logId = `large-stdout-${process.pid}`;

  const spawnStub = mock.method(_spawn, "fn", () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};

    setImmediate(() => {
      child.stdout.emit(
        "data",
        `${JSON.stringify({
          type: "message_end",
          message: {
            content: [{ type: "text", text: largeOutput }],
          },
        })}\n`,
      );
      child.emit("close", 0, null);
    });

    return child;
  });

  try {
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
      logId,
    });

    assert.equal(result.ok, true);
    assert.match(result.stdout, /<persisted-output>/);
    assert.match(result.stdout, new RegExp(`${logId}-stdout\\.txt`));
    const spillFile = result.stdout.match(
      /Full output saved to: `([^`]+)`/,
    )?.[1];
    assert.ok(spillFile, "spill file path appears in envelope");
    assert.equal(await readFile(spillFile, "utf8"), expectedOutput);
    await rm(spillFile, { force: true });
  } finally {
    spawnStub.mock.restore();
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
  }
});

test("spawnSubagent: resolves after agent_end if process hangs", async () => {
  const prev = process.env.PI_SUBAGENT_DEPTH;
  process.env.PI_SUBAGENT_DEPTH = "0";

  const timerStub = mock.method(_timers, "setTimeout", ((
    fn: (...args: any[]) => void,
    ms?: number,
  ) => {
    if (ms === POST_AGENT_END_GRACE_MS) {
      queueMicrotask(() => fn());
    }
    return { ms } as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
  const clearStub = mock.method(_timers, "clearTimeout", () => {});

  const spawnStub = mock.method(_spawn, "fn", () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    child.kill = () => true;

    setImmediate(() => {
      child.stdout.emit(
        "data",
        `${JSON.stringify({
          type: "agent_end",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "done" }],
            },
          ],
        })}\n`,
      );
    });

    return child;
  });

  try {
    const result = await spawnSubagent({
      prompt: "p",
      toolAllowlist: [],
      extensionAllowlist: [],
      cwd: "/tmp",
    });

    assert.equal(result.ok, true);
    assert.equal(result.aborted, false);
    assert.equal(result.stdout, "done");
  } finally {
    spawnStub.mock.restore();
    timerStub.mock.restore();
    clearStub.mock.restore();
    if (prev === undefined) delete process.env.PI_SUBAGENT_DEPTH;
    else process.env.PI_SUBAGENT_DEPTH = prev;
  }
});
