import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { stripVTControlCharacters } from "node:util";
import { getTruncatedText } from "../_shared/render.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import type { RunResult } from "./api.ts";
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
export function presentRun(run: RunResult) {
  const { json, traces, ...accounting } = run;
  return {
    content: [
      {
        type: "text" as const,
        text: `script: ${JSON.stringify({ ...accounting, calls: traces.length, succeeded: traces.filter((t) => t.state === "succeeded").length, failures: traces.filter((t) => t.state === "failed" || t.state === "cancelled").map((t) => ({ id: t.id, code: t.code, outcomeUnknown: t.outcomeUnknown })) })}${run.effectsMayPersist ? "\nEffects may persist; no rollback or automatic retry." : ""}`,
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
      traces,
      calls: traces.length,
      scriptError: run.status !== "success",
    },
  };
}
const display = (v: unknown) =>
  stripVTControlCharacters(String(v ?? ""))
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200);
export const renderers: Pick<
  ToolDefinition<typeof PARAMETERS>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, ctx) {
    return getTruncatedText(ctx.lastComponent, [
      `${theme.fg("toolTitle", theme.bold("script"))} ${theme.fg("muted", display(args.description) || "bounded execution")}`,
    ]);
  },
  renderResult(result, { expanded, isPartial }, theme, ctx) {
    const d = result.details as Record<string, unknown> | undefined;
    const failed = ctx.isError || d?.scriptError === true;
    const lines = [
      theme.fg(
        isPartial ? "warning" : failed ? "error" : "success",
        isPartial
          ? "running..."
          : `${failed ? "failed" : "completed"} · ${display(d?.calls ?? 0)} calls${d?.code ? ` · ${display(d.code)}` : ""}`,
      ),
    ];
    if (d?.outcomeUnknown)
      lines.push(
        theme.fg("error", "Outcome unknown; do not automatically retry."),
      );
    if (d?.partialExecution)
      lines.push(
        theme.fg("warning", "Partial execution; effects may persist."),
      );
    if (expanded && Array.isArray(d?.traces))
      for (const t of d.traces.slice(0, 128))
        lines.push(
          theme.fg(
            "muted",
            `${display(t.id)} ${display(t.tool)} · ${display(t.state)} · ${display(t.durationMs)}ms${t.code ? ` · ${display(t.code)}` : ""}`,
          ),
        );
    return getTruncatedText(ctx.lastComponent, lines);
  },
};
