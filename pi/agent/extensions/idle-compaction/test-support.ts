import {
  SessionManager,
  type CompactOptions,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createIdleCompactionExtension } from "./index.ts";
import { DEFAULT_CONFIG, type IdleConfig } from "./config.ts";
import type { Clock } from "./controller.ts";

export class FakeClock implements Clock {
  value = 0;
  next = 0;
  timers = new Map<number, { due: number; callback: () => void }>();
  now = () => this.value;
  wallTime = () => 1_700_000_000_000 + this.value;
  set = (callback: () => void, ms: number) => {
    const id = ++this.next;
    this.timers.set(id, { due: this.value + ms, callback });
    return id;
  };
  clear = (id: unknown) => {
    this.timers.delete(id as number);
  };
  advance(ms: number) {
    this.value += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.due <= this.value && this.timers.delete(id)) timer.callback();
    }
  }
}

export const user = (text: string) => ({
  role: "user" as const,
  content: text,
  timestamp: 0,
});
export const assistant = (text: string) => ({
  role: "assistant" as const,
  content: [{ type: "text" as const, text }],
  api: "openai-responses" as const,
  provider: "example",
  model: "fixture",
  stopReason: "stop" as const,
  timestamp: 0,
  usage: {
    input: 100,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 110,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});

export function harness(
  options: {
    config?: Partial<IdleConfig>;
    session?: SessionManager;
    loadConfig?: (warnings: string[]) => Promise<IdleConfig>;
  } = {},
) {
  const time = new FakeClock();
  const sm = options.session ?? SessionManager.inMemory();
  if (!options.session) {
    sm.appendMessage(user("hello"));
    sm.appendMessage(assistant("answer"));
  }
  const handlers = new Map<
    string,
    ((event: any, ctx: ExtensionContext) => any)[]
  >();
  const commands = new Map<string, any>();
  const requests: CompactOptions[] = [];
  const notifications: string[] = [];
  let listener: (() => void) | undefined;
  let inputSubscriptions = 0;
  let running = false;
  let pending = false;
  let usage:
    | { tokens: number | null; percent: number | null; contextWindow: number }
    | undefined = { tokens: 500, percent: 50, contextWindow: 1000 };
  const pi = {
    on(event: string, handler: any) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    appendEntry(type: string, data: unknown) {
      sm.appendCustomEntry(type, data);
    },
    sendMessage() {
      throw new Error("must not inject context");
    },
    sendUserMessage() {
      throw new Error("must not start a turn");
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    sessionManager: sm,
    isIdle: () => !running,
    hasPendingMessages: () => pending,
    getContextUsage: () => usage,
    compact: (request: CompactOptions) => {
      requests.push(request);
    },
    ui: {
      notify: (text: string) => {
        notifications.push(text);
      },
      onTerminalInput(callback: () => void) {
        inputSubscriptions++;
        listener = callback;
        return () => {
          listener = undefined;
          inputSubscriptions--;
        };
      },
    },
  } as unknown as ExtensionContext;
  createIdleCompactionExtension({
    clock: time,
    loadConfig:
      options.loadConfig ??
      (async () => ({
        ...DEFAULT_CONFIG,
        enabled: true,
        idleMinutes: 1,
        ...options.config,
      })),
  })(pi as unknown as ExtensionAPI);
  const emit = async (type: string, event: any = {}) => {
    let result;
    for (const handler of handlers.get(type) ?? []) {
      const value = await handler({ type, ...event }, ctx);
      if (value !== undefined) result = value;
    }
    return result;
  };
  return {
    time,
    sm,
    ctx,
    pi,
    requests,
    notifications,
    commands,
    emit,
    input: () => listener?.(),
    subscriptions: () => inputSubscriptions,
    running: (value: boolean) => {
      running = value;
    },
    pending: (value: boolean) => {
      pending = value;
    },
    usage: (value: typeof usage) => {
      usage = value;
    },
    start: () => emit("session_start"),
    command: (action = "status") =>
      commands.get("idle-compaction").handler(action, ctx),
  };
}
