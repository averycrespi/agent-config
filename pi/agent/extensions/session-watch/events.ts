import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const BUILTIN_EVENTS = [
  "agent_start",
  "agent_settled",
  "session_shutdown",
] as const;
export const BUS_EVENTS = [
  "ask-user:input_requested",
  "ask-user:input_resolved",
  "monitor:registered",
  "monitor:terminated",
  "monitor:notification",
  "loop:started",
  "loop:continued",
  "loop:yielded",
  "loop:stopped",
  "loop:resumed",
  "loop:extended",
  "loop:cleared",
  "loop:exhausted",
] as const;
export const EVENTS = [...BUILTIN_EVENTS, ...BUS_EVENTS] as const;
export type EventName = (typeof EVENTS)[number];
export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const eventName = (value: unknown): value is EventName =>
  EVENTS.includes(value as EventName);
export function filters(value: unknown): value is EventName[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8 &&
    value.every(eventName) &&
    new Set(value).size === value.length
  );
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Only producer UUIDs and closed dispositions cross the socket. Never spread payloads. */
export function project(
  name: EventName,
  raw: unknown,
): Record<string, string> | undefined {
  if ((BUILTIN_EVENTS as readonly string[]).includes(name)) return {};
  const data = record(raw);
  if (name.startsWith("ask-user:")) {
    if (!uuid(data.requestId)) return;
    if (name === "ask-user:input_requested")
      return { requestId: data.requestId };
    if (!["answered", "cancelled", "failed"].includes(data.outcome as string))
      return;
    return { requestId: data.requestId, outcome: data.outcome as string };
  }
  if (name.startsWith("monitor:")) {
    if (!uuid(data.id)) return;
    if (name === "monitor:registered") return { id: data.id };
    if (name === "monitor:notification") {
      if (
        !["handoff_unknown", "handed_to_pi"].includes(
          data.notification as string,
        )
      )
        return;
      return { id: data.id, notification: data.notification as string };
    }
    if (
      ![
        "condition",
        "deadline",
        "failure_limit",
        "unsafe_failure",
        "cancelled",
        "invalidated",
      ].includes(data.state as string) ||
      !["pending", "suppressed"].includes(data.notification as string)
    )
      return;
    return {
      id: data.id,
      state: data.state as string,
      notification: data.notification as string,
    };
  }
  if (name === "loop:cleared") return {};
  const loop = record(data.loop);
  if (
    !uuid(loop.id) ||
    !["running", "yielded", "stopped"].includes(loop.status as string)
  )
    return;
  return { id: loop.id, status: loop.status as string };
}

/** Listener failures must not escape into existing publishers (including Loop). */
export function subscribeBus(
  pi: Pick<ExtensionAPI, "events">,
  publish: (name: EventName, metadata: Record<string, string>) => void,
) {
  const off = BUS_EVENTS.map((name) =>
    pi.events.on(name, (data) => {
      try {
        const metadata = project(name, data);
        if (metadata) publish(name, metadata);
      } catch {
        /* observational only */
      }
    }),
  );
  return () => off.forEach((unsubscribe) => unsubscribe());
}

export interface Notice {
  name: EventName;
  sequence: number;
  at: number;
  metadata: Record<string, string>;
}

export function validNotice(value: unknown): value is Notice {
  const n = record(value);
  if (
    !eventName(n.name) ||
    !Number.isSafeInteger(n.sequence) ||
    (n.sequence as number) < 1 ||
    !Number.isSafeInteger(n.at) ||
    (n.at as number) < 0
  )
    return false;
  const m = record(n.metadata);
  const projected = project(
    n.name,
    n.name.startsWith("loop:") ? { loop: m } : m,
  );
  return (
    projected !== undefined &&
    JSON.stringify(projected) === JSON.stringify(m) &&
    Object.keys(n).sort().join() === "at,metadata,name,sequence"
  );
}
