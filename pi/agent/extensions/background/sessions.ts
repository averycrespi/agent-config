import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Bridge as SessionEventBridge,
  subscribeEvents,
  discover as discoverSessions,
} from "./session-transport.ts";
import {
  subscribeBus as subscribeSessionBus,
  EVENTS as SESSION_EVENTS,
  filters as sessionEventFilters,
  type EventName as SessionEventName,
  type Notice as SessionNotice,
} from "./session-events.ts";
import { registerBackgroundProvider } from "./providers.ts";
import { isId } from "./contract.ts";
export function sessionRoot() {
  if (!process.getuid || process.platform === "win32")
    throw new Error("session_events_unavailable");
  return join(realpathSync("/tmp"), `pi-background-events-${process.getuid()}`);
}
const inputSchema = {
  type: "array",
  items: [
    { type: "string" },
    {
      type: "array",
      items: { type: "string", enum: [...SESSION_EVENTS] },
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    },
  ],
  minItems: 2,
  maxItems: 2,
  additionalItems: false,
};
const payloadSchema = {
  type: "object",
  required: ["name", "sequence", "at", "metadata"],
  additionalProperties: false,
  properties: {
    name: { type: "string", enum: [...SESSION_EVENTS] },
    sequence: { type: "integer", minimum: 1 },
    at: { type: "integer", minimum: 0 },
    metadata: {
      type: "object",
      additionalProperties: { type: "string", maxLength: 64 },
      maxProperties: 3,
    },
  },
};
export class SessionProvider {
  private bridge: SessionEventBridge;
  private listeners = new Set<(event: SessionNotice) => void>();
  private sequence = 0;
  private off?: () => void;
  private dispose?: () => void;
  private closed = false;
  constructor(
    private pi: ExtensionAPI,
    sessionId: string,
    private root = sessionRoot(),
  ) {
    this.bridge = new SessionEventBridge(root, sessionId);
  }
  async start() {
    await this.bridge.start();
    if (this.closed) {
      this.bridge.close();
      return;
    }
    this.off = subscribeSessionBus(this.pi, (name, metadata) =>
      this.publish(name, metadata),
    );
    this.dispose = registerBackgroundProvider(this.pi, {
      namespace: "sessions",
      available: () => !this.closed,
      methods: {
        list: {
          description:
            "Discover participating Background session incarnations; no transcripts or session control.",
          inputSchema: { type: "array", maxItems: 0 },
          handler: async () => ({
            value: {
              self: { ...this.bridge.target },
              targets: (await discoverSessions(this.root)).map((t) => ({
                ...t,
              })),
            },
          }),
        },
      },
      events: {
        lifecycle: {
          description:
            "Subscribe to selected safe session lifecycle events. Positional arguments: exact incarnation or local, event names.",
          inputSchema,
          payloadSchema,
          subscribe: async (args, ctx) => {
            const [target, events] = args;
            if (!sessionEventFilters(events)) throw new Error("invalid_events");
            if (target === "local") {
              const startedAt = Date.now();
              const listener = (event: SessionNotice) => {
                if (events.includes(event.name)) ctx.emit({ ...event });
              };
              this.listeners.add(listener);
              const close = () => {
                this.listeners.delete(listener);
                ctx.signal.removeEventListener("abort", close);
              };
              ctx.signal.addEventListener("abort", close, { once: true });
              if (ctx.signal.aborted) {
                close();
                throw new Error("cancelled");
              }
              return {
                coverage: {
                  ...this.bridge.target,
                  startedAt,
                  sequence: this.sequence,
                },
                close,
              };
            }
            if (!isId(target)) throw new Error("invalid_incarnation");
            const sub = await subscribeEvents(
              this.root,
              target,
              events,
              Math.min(86400000, Math.max(1000, ctx.deadlineMs - Date.now())),
              (n) => ctx.emit({ ...n }),
              ctx.lost,
              ctx.signal,
            );
            return {
              coverage: { ...sub.target, startedAt: sub.startedAt },
              close: sub.close,
            };
          },
        },
      },
    });
  }
  publish(name: SessionEventName, metadata: Record<string, string> = {}) {
    if (this.closed) return;
    this.bridge.publish(name, metadata);
    const event = { name, metadata, sequence: ++this.sequence, at: Date.now() };
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(event));
      } catch {
        /* isolated observer */
      }
    }
  }
  close() {
    this.closed = true;
    this.dispose?.();
    this.off?.();
    this.listeners.clear();
    this.bridge.close();
  }
}
