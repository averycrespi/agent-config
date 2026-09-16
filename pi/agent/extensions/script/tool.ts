import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { stripVTControlCharacters } from "node:util";
import { getTruncatedText, plural } from "../_shared/render.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import type { RunResult, describeScriptProviders } from "./api.ts";
import { diagnostic, discoveryCode } from "./diagnostics.ts";
import { jsonSnapshot, MAX_OUTPUT_BYTES } from "./value.ts";
export const PARAMETERS = Type.Object(
  {
    action: StringEnum(["run", "describe"] as const),
    description: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "\\S",
      description:
        "Short nonsecret action/target label. Never include source or payloads.",
    }),
    providers: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]{0,47}$" }), {
      maxItems: 32,
      uniqueItems: true,
      description:
        "Explicit provider selection; [] runs pure computation. For describe only, [] lists permitted registered APIs.",
    }),
    source: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 262144,
        description:
          "Async JavaScript body; explicitly return JSON and await all calls. Required for run.",
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
        text: `script: ${JSON.stringify({ ...accounting, calls: traces.length, succeeded, failures: traces.filter((t) => t.state === "failed" || t.state === "cancelled").map((t) => ({ id: t.id, code: t.code, outcomeUnknown: t.outcomeUnknown })) })}${run.effectsMayPersist ? "\nEffects may persist; no rollback or automatic retry." : ""}${run.status !== "success" && run.effectsMayPersist ? "\nReconcile provider effects before further action." : ""}${guidance ? `\n${guidance}` : ""}`,
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
  if (!names) return `${label}: pending`;
  if (!names.length)
    return `${label}: ${args.action === "describe" ? "all" : "none"}`;
  return `${label}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? `, +${names.length - 3} more` : ""}`;
}

export const renderers: Pick<
  ToolDefinition<typeof PARAMETERS>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, ctx) {
    return getTruncatedText(ctx.lastComponent, [
      `${theme.fg("toolTitle", theme.bold("script"))} ${theme.fg("muted", `${args.action === "describe" ? "describe" : "run"} · ${providerLabel(args)} · ${display(args.description) || "bounded execution"}`)}`,
    ]);
  },
  renderResult(result, { expanded, isPartial }, theme, ctx) {
    const d = result.details as Record<string, unknown> | undefined;
    const args = ctx.args ?? {};
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
      summary = `${state} · ${info?.summary ?? (d?.code ? display(d.code) : "tool execution error")}`;
    } else if (action === "describe") {
      summary =
        d?.providerCount === 0
          ? "completed · no permitted providers discovered"
          : typeof d?.providerCount === "number" &&
              typeof d?.methodCount === "number"
            ? `completed · ${plural(d.providerCount, "provider")} · ${plural(d.methodCount, "method")}`
            : "completed · provider discovery";
    } else if (calls === 0) {
      summary = "completed · no calls";
    } else summary = `completed · ${plural(succeeded, "call")} succeeded`;
    const lines = [
      theme.fg(isPartial ? "warning" : failed ? "error" : "success", summary),
    ];
    if (d?.outcomeUnknown)
      lines.push(
        theme.fg("error", "Outcome unknown; do not automatically retry."),
      );
    if (d?.partialExecution)
      lines.push(
        theme.fg("warning", "Partial execution; effects may persist."),
      );
    if (expanded && !isPartial) {
      if (failed && d?.effectsMayPersist)
        lines.push(
          theme.fg(
            "warning",
            "Reconcile provider effects before further action.",
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
            `${plural(calls, "call")} attempted · ${succeeded} succeeded`,
          ),
        );
      for (const t of traces) {
        lines.push(
          theme.fg(
            "muted",
            `${display(t.id)} ${display(t.tool)} · ${display(t.state)} · ${display(t.durationMs)}ms${t.code ? ` · ${display(t.code)}` : ""}`,
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
