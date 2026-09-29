import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { _loggingFs } from "../_shared/logging.ts";
import statuslineExtension from "./index.ts";
import { _execFile } from "./git.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

type EventHandler = (
  event: unknown,
  ctx: ReturnType<typeof makeCtx>,
) => Promise<void> | void;

function makeCtx() {
  return {
    hasUI: true,
    cwd: "/repo/agent-config",
    model: {
      provider: "openai-codex",
      id: "gpt-5-codex",
      contextWindow: 200_000,
    },
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return { ok: false };
      },
    },
    getContextUsage() {
      return { percent: 42, contextWindow: 200_000, tokens: 84_000 };
    },
    ui: {
      setFooter: (
        _factory: (
          tui: { requestRender(): void },
          theme: typeof identityTheme,
          footerData: unknown,
        ) => { render(width: number): string[]; invalidate(): void },
      ) => {},
    },
  };
}

function rightAligned(left: string, right: string, width = 200): string {
  return `${left}${" ".repeat(width - left.length - right.length)}${right}`;
}

function makePi() {
  const handlers = new Map<string, EventHandler>();
  const commands = new Map<
    string,
    { handler(args: string, ctx: any): Promise<void> }
  >();
  const statuslineCalls: string[][] = [];
  const eventHandlers = new Map<string, Array<(data: unknown) => void>>();
  let thinkingLevel = "medium";

  const pi = {
    registerCommand(
      name: string,
      command: { handler(args: string, ctx: any): Promise<void> },
    ) {
      commands.set(name, command);
    },
    _commands: commands,
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    getThinkingLevel() {
      return thinkingLevel as any;
    },
    events: {
      on(event: string, handler: (data: unknown) => void) {
        const list = eventHandlers.get(event) ?? [];
        list.push(handler);
        eventHandlers.set(event, list);
      },
      emit(event: string, data: unknown) {
        for (const handler of eventHandlers.get(event) ?? []) handler(data);
      },
    },
    _handlers: handlers,
    _statuslineCalls: statuslineCalls,
    _setThinkingLevel(level: string) {
      thinkingLevel = level;
    },
    _ctx() {
      return {
        ...makeCtx(),
        ui: {
          setFooter(
            factory: (
              tui: { requestRender(): void },
              theme: typeof identityTheme,
              footerData: unknown,
            ) => { render(width: number): string[]; invalidate(): void },
          ) {
            let component: {
              render(width: number): string[];
              invalidate(): void;
            };
            component = factory(
              {
                requestRender() {
                  statuslineCalls.push(component.render(200));
                },
              },
              identityTheme,
              {},
            );
            statuslineCalls.push(component.render(200));
          },
        },
      };
    },
  };

  return pi;
}

test("session_start installs a bordered statusline instead of publishing only a status snippet", async () => {
  const pi = makePi();
  statuslineExtension(pi as any);

  const handler = pi._handlers.get("session_start");
  assert.ok(handler, "session_start handler should be registered");

  await handler!({ type: "session_start", reason: "startup" }, pi._ctx());

  assert.deepEqual(pi._statuslineCalls[0], [
    "─".repeat(200),
    rightAligned("/repo/agent-config", "ctx 42%/200k · gpt-5-codex · medium"),
  ]);
});

test("git branch lookup does not block initial rendering and refreshes later", async () => {
  const pi = makePi();
  let finishGit!: () => void;
  const execStub = mock.method(
    _execFile,
    "fn",
    (_file: string, args: string[], _options: unknown, cb: Function) => {
      const command = args.join(" ");
      if (command === "rev-parse --abbrev-ref HEAD") {
        finishGit = () => cb(null, "feature/async\n");
      } else if (
        command === "rev-list --left-right --count @{upstream}...HEAD"
      ) {
        cb(new Error("no upstream"), "");
      } else {
        cb(null, "");
      }
    },
  );

  try {
    statuslineExtension(pi as any);
    const handler = pi._handlers.get("session_start");
    assert.ok(handler, "session_start handler should be registered");

    await handler!({ type: "session_start", reason: "startup" }, pi._ctx());

    assert.deepEqual(pi._statuslineCalls[0], [
      "─".repeat(200),
      rightAligned("/repo/agent-config", "ctx 42%/200k · gpt-5-codex · medium"),
    ]);

    finishGit();
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(
      pi._statuslineCalls.some((call) =>
        call[1]?.includes("/repo/agent-config [feature/async ✔]"),
      ),
    );
  } finally {
    execStub.mock.restore();
  }
});

test("git branch lookup clears stale branch when later cwd is not a git repo", async () => {
  const pi = makePi();
  let call = 0;
  const execStub = mock.method(
    _execFile,
    "fn",
    (_file: string, args: string[], options: any, cb: Function) => {
      call += 1;
      const command = args.join(" ");
      if (options.cwd !== "/repo/agent-config") {
        cb(new Error("not a git repo"), "");
      } else if (command === "rev-parse --abbrev-ref HEAD") {
        cb(null, "feature/old\n");
      } else if (
        command === "rev-list --left-right --count @{upstream}...HEAD"
      ) {
        cb(new Error("no upstream"), "");
      } else {
        cb(null, "");
      }
    },
  );

  try {
    statuslineExtension(pi as any);
    const sessionStart = pi._handlers.get("session_start");
    const turnEnd = pi._handlers.get("turn_end");
    assert.ok(sessionStart, "session_start handler should be registered");
    assert.ok(turnEnd, "turn_end handler should be registered");

    await sessionStart!(
      { type: "session_start", reason: "startup" },
      pi._ctx(),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      pi._statuslineCalls.some((render) =>
        render[1]?.includes("[feature/old ✔]"),
      ),
    );

    await turnEnd!({}, { ...pi._ctx(), cwd: "/tmp/not-a-repo" });
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(call >= 2);
    assert.equal(
      pi._statuslineCalls.at(-1)?.[1]?.includes("[feature/old]"),
      false,
    );
  } finally {
    execStub.mock.restore();
  }
});

test("quota diagnostics replay weekly usage without leaking auth or fetching again", async () => {
  const pi = makePi();
  statuslineExtension(pi as any);
  const notifications: string[] = [];
  const ctx = {
    ...pi._ctx(),
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return {
          ok: true,
          apiKey: `header.${Buffer.from(
            JSON.stringify({
              "https://api.openai.com/auth": {
                chatgpt_account_id: "private-account",
              },
            }),
          ).toString("base64url")}.signature`,
          headers: { "X-Extra": "private-header" },
        };
      },
    },
  };
  const fetchStub = mock.method(globalThis, "fetch", async () =>
    Response.json({
      email: "private@example.com",
      rate_limit: {
        limit_reached: false,
        primary_window: {
          used_percent: 91,
          limit_window_seconds: 604800,
          reset_after_seconds: 337138,
        },
        secondary_window: null,
      },
      additional_rate_limits: null,
      credits: { has_credits: false, balance: "private-balance" },
    }),
  );
  try {
    const debug = pi._commands.get("statusline-debug")!;
    const debugCtx = {
      ...ctx,
      ui: { ...ctx.ui, notify: (text: string) => notifications.push(text) },
    };
    await debug.handler("", debugCtx);
    assert.equal(JSON.parse(notifications.pop()!).hasUsage, false);
    assert.equal(fetchStub.mock.callCount(), 0);

    await pi._handlers.get("session_start")!({}, pi._ctx());
    await new Promise((resolve) => setImmediate(resolve));
    await pi._handlers.get("turn_end")!({}, ctx);
    await debug.handler("", debugCtx);
    const output = notifications.pop()!;
    const snapshot = JSON.parse(output);
    assert.equal(snapshot.diagnosticVersion, 2);
    assert.equal(snapshot.quotaSource, "rate_limit");
    assert.deepEqual(snapshot.primary, {
      usedPercent: 91,
      resetAfterSeconds: 337138,
    });
    assert.equal(snapshot.secondary, null);
    assert.equal(snapshot.limitReached, false);
    assert.equal(snapshot.accountHeaderPresent, true);
    assert.equal(snapshot.hasBalance, false);
    assert.ok(snapshot.fetchedAt);
    assert.doesNotMatch(
      output,
      /header\.|signature|private-header|private-account|private@example|private-balance/,
    );
    assert.ok(
      pi._statuslineCalls.some((lines) =>
        lines.some((line) => line.includes("Codex 91% 3d 21h")),
      ),
    );
    assert.equal(fetchStub.mock.callCount(), 1);

    await debug.handler("", { ...debugCtx, hasUI: false });
    assert.equal(notifications.length, 0);
  } finally {
    fetchStub.mock.restore();
  }
});

test("failed usage fetches are not debounced as successful fetches", async () => {
  const pi = makePi();
  statuslineExtension(pi as any);
  const turnEnd = pi._handlers.get("turn_end");
  assert.ok(turnEnd, "turn_end handler should be registered");

  const ctx = {
    ...makeCtx(),
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "token", headers: {} };
      },
    },
  };
  const fetchStub = mock.method(
    globalThis,
    "fetch",
    async () => ({ ok: false }) as Response,
  );

  try {
    await turnEnd!({}, ctx);
    await turnEnd!({}, ctx);
  } finally {
    fetchStub.mock.restore();
  }

  assert.equal(fetchStub.mock.callCount(), 2);
});

test("usage fetch failures are logged once per session", async () => {
  const root = await mkdtemp(join(tmpdir(), "statusline-log-test-"));
  const tmpStub = mock.method(_loggingFs, "tmpdir", () => root);
  const pi = makePi();
  statuslineExtension(pi as any);
  const turnEnd = pi._handlers.get("turn_end");
  assert.ok(turnEnd, "turn_end handler should be registered");

  const ctx = {
    ...makeCtx(),
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "token", headers: {} };
      },
    },
  };
  const fetchStub = mock.method(
    globalThis,
    "fetch",
    async () => ({ ok: false }) as Response,
  );

  try {
    await turnEnd!({}, ctx);
    await turnEnd!({}, ctx);

    assert.equal(fetchStub.mock.callCount(), 2);
    const files = await readdir(join(root, "pi-extension-logs", "statusline"));
    assert.equal(files.length, 1);
    assert.match(files[0]!, /quota-fetch-failure/);
  } finally {
    fetchStub.mock.restore();
    tmpStub.mock.restore();
    await rm(root, { recursive: true, force: true });
  }
});
