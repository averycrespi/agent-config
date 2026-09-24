import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Ajv } from "ajv";
import {
  registerScriptProvider,
  describeScriptProviders,
  snapshotScriptJson,
  type ScriptProvider,
  type JsonValue,
} from "../script/api.ts";

type Bus = Pick<ExtensionAPI, "events">;
export interface Subscription {
  coverage: JsonValue;
  close(): void;
}
export interface EventSource {
  description: string;
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
  subscribe(
    args: JsonValue[],
    context: {
      signal: AbortSignal;
      deadlineMs: number;
      emit(payload: JsonValue): void;
      lost(): void;
    },
  ): Promise<Subscription>;
}
export interface MonitorProvider extends ScriptProvider {
  events: Record<string, EventSource>;
}
export interface Selection {
  provider: string;
  event: string;
  args: JsonValue[];
}
type Registered = {
  namespace: string;
  events: Map<string, EventSource>;
  signal: AbortSignal;
};
const QUERY = "monitor:providers-v1";
const name = (v: string) => /^[a-z][a-z0-9_]{0,47}$/.test(v);
function collect(pi: Bus) {
  const all: Registered[] = [];
  pi.events.emit(QUERY, { accept: (p: Registered) => all.push(p) });
  if (
    all.length > 32 ||
    new Set(all.map((p) => p.namespace)).size !== all.length
  )
    throw new Error("event_provider_conflict");
  return all;
}

/** Host-only typed subscriptions share Script's registration, policy and disposal. */
export function registerMonitorProvider(pi: Bus, provider: MonitorProvider) {
  const errors: string[] = [];
  const events = new Map<string, EventSource>();
  const definitions = Object.entries(provider.events ?? {});
  if (!definitions.length || definitions.length > 16)
    errors.push("invalid_events");
  for (const [key, source] of definitions) {
    try {
      if (
        !name(key) ||
        typeof source.subscribe !== "function" ||
        typeof source.description !== "string" ||
        !source.description.trim() ||
        source.description.length > 500 ||
        /[\p{Cc}\p{Cf}]/u.test(source.description)
      )
        throw new Error();
      const inputSchema = JSON.parse(
        snapshotScriptJson(source.inputSchema, 16384),
      );
      const payloadSchema = JSON.parse(
        snapshotScriptJson(source.payloadSchema, 16384),
      );
      if (
        inputSchema.type !== "array" ||
        JSON.stringify([inputSchema, payloadSchema]).includes('"$async"')
      )
        throw new Error();
      const ajv = new Ajv({ strict: true, ownProperties: true });
      const input = ajv.compile(inputSchema),
        payload = ajv.compile(payloadSchema);
      events.set(key, {
        description: source.description,
        inputSchema,
        payloadSchema,
        async subscribe(args, ctx) {
          if (!input(args)) throw new Error("invalid_event_arguments");
          return source.subscribe(args, {
            ...ctx,
            emit(value) {
              try {
                const copy = JSON.parse(snapshotScriptJson(value, 4096));
                if (!payload(copy)) throw new Error();
                ctx.emit(copy as JsonValue);
              } catch {
                ctx.lost();
              }
            },
          });
        },
      });
    } catch {
      errors.push("invalid_event_schema");
    }
  }
  if (collect(pi).some((p) => p.namespace === provider.namespace))
    errors.push("event_provider_conflict");
  if (errors.length) throw new Error([...new Set(errors)].join(", "));
  const disposeScript = registerScriptProvider(pi, provider);
  const controller = new AbortController();
  const registered = {
    namespace: provider.namespace,
    events,
    signal: controller.signal,
  };
  const off = pi.events.on(QUERY, (value: any) => value?.accept?.(registered));
  return () => {
    controller.abort();
    off();
    disposeScript();
  };
}

export async function describeEvents(
  pi: Bus,
  cwd: string,
  providers: string[],
  signal?: AbortSignal,
) {
  const allowed = await describeScriptProviders(
    pi,
    cwd,
    providers,
    providers.length ? providers : undefined,
    signal,
  );
  return collect(pi)
    .filter((p) => allowed.some((a) => a.namespace === p.namespace))
    .map((p) => ({
      provider: p.namespace,
      events: [...p.events].map(([event, e]) => ({
        event,
        description: e.description,
        inputSchema: structuredClone(e.inputSchema),
        payloadSchema: structuredClone(e.payloadSchema),
      })),
    }));
}

export async function subscribeProvider(
  pi: Bus,
  cwd: string,
  providers: string[],
  selection: Selection,
  context: Parameters<EventSource["subscribe"]>[1],
): Promise<Subscription> {
  await describeScriptProviders(pi, cwd, providers, providers, context.signal);
  if (!providers.includes(selection.provider))
    throw new Error("event_provider_denied");
  const p = collect(pi).find((p) => p.namespace === selection.provider);
  const source = p?.events.get(selection.event);
  if (!p || !source || p.signal.aborted) throw new Error("event_unavailable");
  const setup = new AbortController();
  const timer = setTimeout(
    () => setup.abort(),
    Math.max(0, Math.min(2000, context.deadlineMs - Date.now())),
  );
  timer.unref();
  const signal = AbortSignal.any([context.signal, p.signal, setup.signal]);
  const loss = () => {
    if (!context.signal.aborted) context.lost();
  };
  p.signal.addEventListener("abort", loss, { once: true });
  let sub: Subscription | undefined;
  let rejectAbort: (() => void) | undefined;
  try {
    if (signal.aborted) throw new Error();
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error("event_setup_interrupted"));
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const starting = Promise.resolve().then(() =>
      source.subscribe(selection.args, { ...context, signal }),
    );
    void starting.then(
      (late) => {
        if (signal.aborted) {
          try {
            late.close();
          } catch {
            /* no retry */
          }
        }
      },
      () => {},
    );
    sub = await Promise.race([starting, aborted]);
    if (signal.aborted || Date.now() >= context.deadlineMs)
      throw new Error("event_setup_interrupted");
    const coverage = JSON.parse(snapshotScriptJson(sub.coverage, 4096));
    return {
      coverage,
      close() {
        p.signal.removeEventListener("abort", loss);
        sub!.close();
      },
    };
  } catch {
    p.signal.removeEventListener("abort", loss);
    sub?.close();
    throw new Error("event_setup_failed");
  } finally {
    clearTimeout(timer);
    if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
  }
}
