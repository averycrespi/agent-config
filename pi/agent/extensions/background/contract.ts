import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import {
  snapshotScriptJson,
  type JsonValue,
  type RunResult,
} from "../script/api.ts";
import type { Selection } from "./providers.ts";
import {
  DEFAULT_CONFIG,
  CONFIG_WARNING,
  type BackgroundConfig,
} from "./config.ts";
export const LIMITS = Object.freeze({
  active: 4,
  concurrent: 2,
  queue: 32,
  receipts: 32,
  wakes: 100,
  evaluations: 10000,
  source: 232 * 1024,
});
export const uuid = () => randomUUID();
export const isId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
export const label = (v: unknown, max = 80) =>
  typeof v === "string"
    ? stripVTControlCharacters(v)
        .replace(/[\p{Cc}\p{Cf}]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
export class RequestError extends Error {}
export interface Registration {
  name: string;
  message: string;
  providers: string[];
  source?: string;
  cycleMs: number;
  lifetimeMs: number;
  deadlineMs?: number;
  maxWakes: number;
  recurring: boolean;
  intervalMs?: number;
  delayMs?: number;
  events: Selection[];
  state: JsonValue;
}
export interface Trigger {
  kind: "initial" | "timer" | "event";
  at: number;
  subscription?: number;
  payload?: JsonValue;
}
export type Reason =
  | "condition"
  | "timeout"
  | "evaluation_failure"
  | "coverage_failure"
  | "budget_exhausted";
export interface Attention {
  id: string;
  reason: Reason;
  at: number;
  disposition: "pending" | "suppressed" | "handoff_unknown" | "handed_to_pi";
  admitted: boolean;
}
export interface Receipt {
  id: string;
  name: string;
  createdAt: number;
  /** First observation stop; absent for interrupted older receipts. */
  endedAt?: number;
  deadline: number;
  cycleDeadline: number;
  nextAt?: number;
  status: "active" | "finished" | "cancelled" | "invalidated";
  recurring: boolean;
  cycleMs: number;
  /** Optional display metadata; older receipts remain readable. */
  intervalMs?: number;
  delayMs?: number;
  eventCount?: number;
  maxWakes: number;
  wakes: number;
  evaluations: number;
  calls: number;
  inFlight: boolean;
  awaitingSettlement: boolean;
  state: JsonValue;
  evidence: JsonValue;
  evidenceAt?: number;
  coverage: JsonValue[];
  gap: boolean;
  interrupted: boolean;
  effectsMayPersist: boolean;
  outcomeUnknown: boolean;
  attention?: Attention;
  lastAttention?: Attention;
  accounting?: Omit<RunResult, "json">;
  failureCode?: string;
}
const int = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
export function registration(
  raw: Record<string, unknown>,
  config: Readonly<BackgroundConfig> = DEFAULT_CONFIG,
): Registration {
  if (!config.valid) throw new RequestError(CONFIG_WARNING);
  const errors: string[] = [];
  const allowed = [
    "action",
    "name",
    "message",
    "providers",
    "source",
    "cycle_timeout_ms",
    "lifetime_ms",
    "deadline_ms",
    "max_wakes",
    "recurring",
    "interval_ms",
    "delay_ms",
    "events",
    "state",
    "retain",
  ];
  if (Object.keys(raw).some((k) => !allowed.includes(k)))
    errors.push("Unexpected start fields.");
  if (typeof raw.name !== "string" || !label(raw.name) || raw.name.length > 80)
    errors.push("name must be nonblank, at most 80 characters.");
  if (
    typeof raw.message !== "string" ||
    !label(raw.message) ||
    raw.message.length > 2000
  )
    errors.push("message must be nonblank, at most 2000 characters.");
  if (
    !Array.isArray(raw.providers) ||
    raw.providers.length > 32 ||
    !raw.providers.every(
      (p) =>
        typeof p === "string" &&
        !["trigger", "state"].includes(p) &&
        /^[a-z][a-z0-9_]{0,47}$/.test(p),
    ) ||
    new Set(raw.providers).size !== raw.providers.length
  )
    errors.push(
      "Explicit unique providers are required (use [] for pure evaluation).",
    );
  if (!int(raw.cycle_timeout_ms, 1000, config.maxCycleTimeoutMs))
    errors.push(
      `cycle_timeout_ms is required: 1000–${config.maxCycleTimeoutMs}.`,
    );
  if (!int(raw.lifetime_ms, 1000, config.maxLifetimeMs))
    errors.push(`lifetime_ms is required: 1000–${config.maxLifetimeMs}.`);
  if (
    raw.deadline_ms !== undefined &&
    !int(raw.deadline_ms, 0, Number.MAX_SAFE_INTEGER)
  )
    errors.push("deadline_ms must be a nonnegative absolute host timestamp.");
  if (!int(raw.max_wakes, 1, LIMITS.wakes))
    errors.push("max_wakes is required: 1–100.");
  if (raw.retain !== undefined && typeof raw.retain !== "boolean")
    errors.push("retain must be boolean.");
  if (raw.recurring !== undefined && typeof raw.recurring !== "boolean")
    errors.push("recurring must be boolean.");
  if (!raw.recurring && raw.max_wakes !== 1)
    errors.push("One-shot jobs require max_wakes: 1.");
  if (
    raw.source !== undefined &&
    (typeof raw.source !== "string" ||
      !raw.source.trim() ||
      Buffer.byteLength(raw.source) > LIMITS.source)
  )
    errors.push("source must be nonblank, at most 232 KiB.");
  for (const field of ["interval_ms", "delay_ms"])
    if (
      raw[field] !== undefined &&
      !int(raw[field], 1000, config.maxCycleTimeoutMs)
    )
      errors.push(`${field} must be 1000–${config.maxCycleTimeoutMs}.`);
  if (raw.interval_ms !== undefined && raw.delay_ms !== undefined)
    errors.push(
      "Polling interval and continuation delay are alternative timer modes.",
    );
  if (raw.interval_ms !== undefined && !raw.source)
    errors.push(
      "Polling requires an evaluator; use delay_ms for no-code continuation.",
    );
  if (
    raw.delay_ms !== undefined &&
    (raw.source !== undefined ||
      (Array.isArray(raw.events) && raw.events.length))
  )
    errors.push("delay_ms is only for timer-only no-code continuation.");
  const events = raw.events ?? [];
  if (
    !Array.isArray(events) ||
    events.length > 4 ||
    events.some(
      (e) =>
        !e ||
        typeof e !== "object" ||
        Object.keys(e).sort().join() !== "args,event,provider" ||
        typeof e.provider !== "string" ||
        typeof e.event !== "string" ||
        !Array.isArray(e.args),
    )
  )
    errors.push(
      "events must contain at most four provider/event/args selections.",
    );
  if (
    raw.interval_ms === undefined &&
    raw.delay_ms === undefined &&
    (!Array.isArray(events) || !events.length)
  )
    errors.push("At least one timer or event trigger is required.");
  let state: JsonValue = null,
    copiedEvents: Selection[] = [];
  try {
    state = JSON.parse(snapshotScriptJson(raw.state ?? null, 4096));
    copiedEvents = JSON.parse(snapshotScriptJson(events, 8192));
  } catch {
    errors.push("state/events must be bounded plain JSON.");
  }
  if (errors.length) throw new RequestError(errors.join("\n"));
  return {
    name: label(raw.name),
    message: raw.message as string,
    providers: [...(raw.providers as string[])],
    source: raw.source as string | undefined,
    cycleMs: raw.cycle_timeout_ms as number,
    lifetimeMs: raw.lifetime_ms as number,
    ...(raw.deadline_ms === undefined
      ? {}
      : { deadlineMs: raw.deadline_ms as number }),
    maxWakes: raw.max_wakes as number,
    recurring: raw.recurring === true,
    intervalMs: raw.interval_ms as number | undefined,
    delayMs: raw.delay_ms as number | undefined,
    events: copiedEvents,
    state,
  };
}
export function observation(result: RunResult): {
  decision: "wait" | "wake";
  evidence: JsonValue;
  state?: JsonValue;
} {
  if (
    result.status !== "success" ||
    result.outcomeUnknown ||
    result.traces.some((t) => t.state !== "succeeded")
  )
    throw new Error("evaluation_failed");
  const value = JSON.parse(result.json ?? "null");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !["wait", "wake"].includes(value.decision) ||
    !Object.hasOwn(value, "evidence") ||
    Object.keys(value).some(
      (k) => !["decision", "evidence", "state"].includes(k),
    )
  )
    throw new Error("invalid_observation");
  snapshotScriptJson(value.evidence, 4096);
  if (Object.hasOwn(value, "state")) snapshotScriptJson(value.state, 4096);
  return value;
}
