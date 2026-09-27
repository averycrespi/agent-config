import {
  clearPartialTimer,
  expandedBodyResult,
  getResultTextComponent,
  getTruncatedText,
  toolCall,
} from "../_shared/render.ts";
import type { SubagentRunState } from "./types.ts";
import { renderExecutionResult } from "../background/render.ts";

// Execution consumers still use activity extraction; this is not legacy layout machinery.
export function getActivity(details: unknown): SubagentRunState | undefined {
  if (!details || typeof details !== "object") return undefined;
  const record = details as Record<string, unknown>;
  const activity = record.activity;
  if (activity && typeof activity === "object")
    return activity as SubagentRunState;
  if (
    typeof record.intent === "string" &&
    typeof record.phase === "string" &&
    typeof record.startedAt === "number" &&
    typeof record.lastUpdateAt === "number"
  )
    return record as unknown as SubagentRunState;
  return undefined;
}

export function renderAgentsCall(
  args: {
    agents?: unknown[];
    action?: unknown;
    execution?: unknown;
    id?: unknown;
  },
  theme: any,
  context: any,
) {
  return getTruncatedText(context.lastComponent, [
    toolCall(
      theme,
      "subagent",
      args.action ?? "run",
      args.action === "inspect" ||
        args.action === "cancel" ||
        args.action === "dismiss"
        ? typeof args.id === "string"
          ? args.id.slice(0, 8)
          : undefined
        : (args.agents?.[0] as { intent?: unknown } | undefined)?.intent,
    ),
  ]);
}

export function renderAgentsResult(
  result: { content: { type: string; text?: string }[]; details?: unknown },
  options: { isPartial: boolean; expanded?: boolean },
  theme: any,
  context: any,
) {
  clearPartialTimer(context);
  const details = (result.details ?? {}) as {
    validationError?: boolean;
    execution?: { id: string; status: string; result?: unknown };
    executions?: unknown[];
  };
  // Retained foreground payloads are not Background envelopes, even when args say run.
  if (details.execution || details.executions)
    return renderExecutionResult(
      "subagent",
      details.executions ?? [details.execution],
      result as any,
      options,
      theme,
      context,
      details.validationError === true,
    );
  const failed = details.validationError || context.isError;
  const summary = options.isPartial
    ? theme.fg("muted", "pending…")
    : failed
      ? theme.fg("error", "request failed")
      : theme.fg("muted", "historical result");
  return getResultTextComponent(
    context.lastComponent,
    [summary],
    options.expanded
      ? expandedBodyResult(result as any).map((row) => theme.fg("text", row))
      : [],
  );
}
