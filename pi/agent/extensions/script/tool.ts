import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { stripVTControlCharacters } from "node:util";
import {
  getTruncatedText,
  plural,
  toolCall,
  outcomeLine,
} from "../_shared/render.ts";
import {
  isBackgroundControl,
  renderExecutionResult,
} from "../background/render.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import type { RunResult, describeScriptProviders } from "./api.ts";
import { diagnostic, discoveryCode } from "./diagnostics.ts";
import { jsonSnapshot, MAX_OUTPUT_BYTES } from "./value.ts";
export const PARAMETERS = Type.Object(
  {
    action: StringEnum([
      "run",
      "describe",
      "list",
      "validate",
      "executions",
      "inspect",
      "cancel",
      "dismiss",
    ] as const),
    execution: Type.Optional(StringEnum(["foreground", "background"] as const)),
    id: Type.Optional(Type.String({ maxLength: 36 })),
    description: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "\\S",
      description:
        "Short nonsecret action/target label. Never include source or payloads.",
    }),
    providers: Type.Optional(
      Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]{0,47}$" }), {
        maxItems: 32,
        uniqueItems: true,
        description:
          "Explicit provider selection; [] runs pure computation. For describe only, [] lists permitted registered APIs.",
      }),
    ),
    name: Type.Optional(Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" })),
    args: Type.Optional(
      Type.Unknown({
        description:
          "JSON object for named execution/validation; defaults to {}.",
      }),
    ),
    source: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 262144,
        description:
          "Async JavaScript body; explicitly return JSON and await all calls. Run requires exactly one of source or saved name.",
      }),
    ),
  },
  { additionalProperties: false },
);
export function presentRun(run: RunResult, action: "run" | "describe" = "run") {
  const { json, traces, ...accounting } = run;
  const succeeded = traces.filter((t) => t.state === "succeeded").length;
  const guidance =
    run.status === "success"
      ? undefined
      : diagnostic(run.code, action)?.guidance;
  return {
    content: [
      {
        type: "text" as const,
        text: `script: ${JSON.stringify({ ...accounting, calls: traces.length, succeeded, failures: traces.filter((t) => t.state === "failed" || t.state === "cancelled").map((t) => ({ id: t.id, code: t.code, outcomeUnknown: t.outcomeUnknown })) })}${run.status !== "success" && run.effectsMayPersist ? "\nProvider calls were dispatched; inspect their outcomes before further action. No automatic retry or rollback." : ""}${guidance ? `\n${guidance}` : ""}`,
      },
      ...(json === undefined
        ? []
        : [
            {
              type: "text" as const,
              text: wrapUntrustedContent("SCRIPT RETURN VALUE", json),
            },
          ]),
    ],
    details: {
      ...accounting,
      action,
      traces,
      calls: traces.length,
      succeeded,
      scriptError: run.status !== "success",
    },
  };
}
export function presentDiscovery(
  providers: Awaited<ReturnType<typeof describeScriptProviders>>,
) {
  const json = jsonSnapshot(providers, MAX_OUTPUT_BYTES);
  const inventory = providers.map((p) => ({
    namespace: p.namespace,
    methods: p.methods.map((m) => m.name),
  }));
  return {
    content: [
      {
        type: "text" as const,
        text: wrapUntrustedContent("SCRIPT PROVIDER SCHEMAS", json),
      },
    ],
    details: {
      action: "describe" as const,
      status: "success" as const,
      calls: 0,
      inventory,
      providerCount: inventory.length,
      methodCount: inventory.reduce((sum, p) => sum + p.methods.length, 0),
    },
  };
}

export function discoveryFailure(error: unknown, cancelled: boolean) {
  return presentRun(
    {
      status: cancelled ? "cancelled" : "failed",
      code: discoveryCode(error, cancelled),
      traces: [],
      effectsMayPersist: false,
      partialExecution: false,
      outcomeUnknown: false,
    },
    "describe",
  );
}

const display = (v: unknown) =>
  stripVTControlCharacters(String(v ?? ""))
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
const providerNames = (value: unknown) =>
  Array.isArray(value)
    ? value
        .slice(0, 32)
        .map((name) =>
          typeof name === "string" && /^[a-z][a-z0-9_]{0,47}$/.test(name)
            ? name
            : "(invalid)",
        )
    : undefined;

function providerLabel(args: { action?: unknown; providers?: unknown }) {
  const names = providerNames(args.providers);
  const label = args.action === "describe" ? "scope" : "providers";
  if (!names) return "";
  if (!names.length)
    return `${label}: ${args.action === "describe" ? "all" : "none"}`;
  return `${label}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? `, +${names.length - 3} more` : ""}`;
}

export const renderers: Pick<
  ToolDefinition<typeof PARAMETERS>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, ctx) {
    if (isBackgroundControl("script", args))
      return getTruncatedText(ctx.lastComponent, [
        toolCall(
          theme,
          "script",
          args.action ?? "run",
          args.id?.slice(0, 8) ?? args.name ?? args.description,
        ),
      ]);
    return getTruncatedText(ctx.lastComponent, [
      toolCall(
        theme,
        "script",
        display(args.action) || "run",
        args.action === "list" || args.action === "validate"
          ? args.name
          : args.description,
        args.action === "run" || args.action === "describe"
          ? providerLabel(args)
          : "",
      ),
    ]);
  },
  renderResult(result, { expanded, isPartial }, theme, ctx) {
    const d = result.details as Record<string, unknown> | undefined;
    const args = ctx.args ?? {};
    if (
      d?.saved === true ||
      args.action === "list" ||
      args.action === "validate"
    ) {
      const entries = Array.isArray(d?.entries) ? d.entries : [];
      const failed = ctx.isError || d?.scriptError === true;
      const lines = [
        outcomeLine(
          theme,
          `${isPartial ? "checking..." : failed ? "failed" : args.action === "validate" ? "validated (not executed)" : `${entries.length} saved script(s)`}${d?.truncated ? "; truncated" : ""}`,
          isPartial ? "warning" : failed ? "error" : "muted",
        ),
      ];
      if (expanded)
        for (const entry of entries)
          lines.push(
            theme.fg(
              entry.valid ? "muted" : "error",
              `${display(entry.name ?? entry.filename)} (${entry.valid ? "valid" : display(entry.diagnostic)})`,
            ),
          );
      return getTruncatedText(ctx.lastComponent, lines);
    }
    if (d?.background === true || isBackgroundControl("script", args)) {
      return renderExecutionResult(
        "script",
        d?.records,
        result,
        { expanded, isPartial },
        theme,
        ctx,
        d?.scriptError === true,
      );
    }
    const action =
      d?.action === "describe" || args.action === "describe"
        ? "describe"
        : "run";
    const failed =
      ctx.isError ||
      d?.scriptError === true ||
      ["failed", "cancelled", "timeout"].includes(String(d?.status));
    const info = diagnostic(d?.code, action);
    const traces = Array.isArray(d?.traces) ? d.traces.slice(0, 128) : [];
    const calls = typeof d?.calls === "number" ? d.calls : traces.length;
    const succeeded =
      typeof d?.succeeded === "number"
        ? d.succeeded
        : traces.filter((t) => t.state === "succeeded").length;
    let summary: string;
    if (isPartial)
      summary =
        action === "describe" ? "discovering providers..." : "running...";
    else if (failed) {
      const state =
        d?.status === "cancelled"
          ? "cancelled"
          : d?.status === "timeout"
            ? "timed out"
            : d?.code === "capability_denied" && !d?.effectsMayPersist
              ? "blocked"
              : "failed";
      summary = `${state}: ${info?.summary ?? (d?.code ? display(d.code) : "tool execution error")}`;
    } else if (action === "describe") {
      summary =
        d?.providerCount === 0
          ? "completed (no permitted providers discovered)"
          : typeof d?.providerCount === "number" &&
              typeof d?.methodCount === "number"
            ? `completed (${plural(d.providerCount, "provider")}, ${plural(d.methodCount, "method")})`
            : "completed (provider discovery)";
    } else if (calls === 0) {
      summary = "completed (no calls)";
    } else summary = `completed (${plural(succeeded, "call")} succeeded)`;
    const lines = [
      outcomeLine(
        theme,
        summary,
        isPartial ? "warning" : failed ? "error" : "muted",
      ),
    ];
    if (d?.outcomeUnknown)
      lines.push(
        theme.fg("error", "Outcome unknown; do not automatically retry."),
      );
    if (failed && d?.partialExecution)
      lines.push(
        theme.fg("warning", "Partial execution; inspect provider outcomes."),
      );
    if (expanded && !isPartial) {
      if (failed && d?.effectsMayPersist)
        lines.push(
          theme.fg(
            "warning",
            "Inspect dispatched provider outcomes before further action; no automatic retry.",
          ),
        );
      if (failed && info) lines.push(theme.fg("muted", info.guidance));
      if (failed && d?.code)
        lines.push(theme.fg("muted", `code: ${display(d.code)}`));
      if ((providerNames(args.providers)?.length ?? 0) > 3)
        for (const name of providerNames(args.providers)!)
          lines.push(theme.fg("muted", `selected provider: ${name}`));
      if (action === "describe" && d?.providerCount === 0)
        lines.push(
          theme.fg(
            "muted",
            "Inspect /script-config and provider extension readiness.",
          ),
        );
      if (action === "describe" && Array.isArray(d?.inventory))
        for (const p of d.inventory.slice(0, 32))
          for (const method of Array.isArray(p.methods)
            ? p.methods.slice(0, 32)
            : [])
            lines.push(
              theme.fg("muted", `${display(p.namespace)}.${display(method)}`),
            );
      if (calls > 0)
        lines.push(
          theme.fg(
            "muted",
            `${plural(calls, "call")} attempted, ${succeeded} succeeded`,
          ),
        );
      for (const t of traces) {
        lines.push(
          theme.fg(
            "muted",
            `${display(t.id)} ${display(t.tool)} (${display(t.state)}, ${display(t.durationMs)}ms${t.code ? `, ${display(t.code)}` : ""})`,
          ),
        );
        const callInfo = diagnostic(t.code, "run");
        if (callInfo && t.code !== d?.code)
          lines.push(theme.fg("muted", callInfo.guidance));
      }
    }
    return getTruncatedText(ctx.lastComponent, lines);
  },
};
