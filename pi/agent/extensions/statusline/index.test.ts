import assert from "node:assert/strict";
import { mock, test } from "node:test";
import statuslineExtension from "./index.ts";

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

function makePi() {
  const handlers = new Map<string, EventHandler>();
  const statuslineCalls: string[][] = [];
  const eventHandlers = new Map<string, Array<(data: unknown) => void>>();
  let thinkingLevel = "medium";

  const pi = {
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

test("session_start installs a single-line statusline instead of publishing only a status snippet", async () => {
  const pi = makePi();
  statuslineExtension(pi as any);

  const handler = pi._handlers.get("session_start");
  assert.ok(handler, "session_start handler should be registered");

  await handler!({ type: "session_start", reason: "startup" }, pi._ctx());

  assert.deepEqual(pi._statuslineCalls[0], [
    "/repo/agent-config · ctx 42%/200k · gpt-5-codex · medium",
  ]);
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
