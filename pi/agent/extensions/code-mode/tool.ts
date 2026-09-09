import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getTruncatedText } from "../_shared/render.ts";
import { spillIfNeeded, THRESHOLD_CHARS } from "../_shared/spillover.ts";
import { wrapUntrustedContent } from "../_shared/untrusted.ts";
import { redactCredentials, sanitizeGatewayText } from "../mcp-gateway/api.ts";
import type { RunResult } from "./runtime.ts";

export const PARAMETERS = Type.Object(
  {
    description: Type.String({
      minLength: 1,
      maxLength: 200,
      // Provider regex dialects reject Unicode property escapes; check Cf locally.
      pattern: "\\S",
      description:
        "Short description of this invocation's concrete action and target, shown in the tool row. Avoid generic labels, secrets, and raw payloads.",
    }),
    source: Type.String({
      minLength: 1,
      maxLength: 262144,
      description:
        "Async JavaScript body. Use mcp.call(name, args), parallel(thunks), and explicitly return a JSON value. Discovery uses mcp_search/mcp_describe.",
    }),
  },
  { additionalProperties: false },
);
export function summary(run: RunResult) {
  return {
    status: run.status,
    code: run.code,
    calls: run.traces.length,
    succeeded: run.traces.filter((t) => t.state === "succeeded").length,
    partialExecution: run.partialExecution,
    effectsMayPersist: run.effectsMayPersist,
    outcomeUnknown: run.outcomeUnknown,
    failures: run.traces
      .filter((t) => t.state === "failed" || t.state === "cancelled")
      .map((t) => ({
        id: t.id,
        code: t.code,
        reason: t.reason,
        invocationId: t.invocationId,
        outcomeUnknown: t.outcomeUnknown,
      })),
  };
}
export async function presentRun(
  run: RunResult,
  id: string,
  dir?: string,
): Promise<AgentToolResult<Record<string, unknown>>> {
  const metadata = summary(run);
  let output: AgentToolResult<unknown>["content"] = [];
  let spillFilePath: string | undefined;
  let overflow = false;
  if (run.json !== undefined) {
    const text = wrapUntrustedContent(
      "CODE RETURN VALUE",
      redactCredentials(run.json),
    );
    const spill = await spillIfNeeded([{ type: "text", text }], id, dir);
    if (spill.spilled) {
      spillFilePath = spill.filePath;
      output = [
        {
          type: "text",
          text: wrapUntrustedContent(
            "CODE RETURN VALUE",
            String(spill.content[0].text),
          ),
        },
      ];
    } else if (text.length > THRESHOLD_CHARS) overflow = true;
    else output = [{ type: "text", text }];
  }
  return {
    content: [
      {
        type: "text",
        text: `code: ${JSON.stringify({ ...metadata, output: overflow ? "overflow_not_retained" : spillFilePath ? "spilled" : run.json === undefined ? "absent" : "inline" })}${run.effectsMayPersist ? "\nExecution is not transactional. Effects may persist; no rollback or automatic retry." : ""}${overflow ? "\nReturned output exceeded the inline limit and could not be retained. No full result is available; do not replay calls automatically." : ""}`,
      },
      ...output,
    ],
    details: {
      ...metadata,
      codeError: run.status !== "success" || overflow,
      traces: run.traces,
      spillFilePath,
    },
  };
}
const display = (v: unknown) =>
  sanitizeGatewayText(typeof v === "string" ? v : String(v ?? "")).slice(
    0,
    200,
  );
export const renderers: Pick<
  ToolDefinition<typeof PARAMETERS>,
  "renderCall" | "renderResult"
> = {
  renderCall(args, theme, ctx) {
    const description =
      (typeof args.description === "string" &&
        Array.from(
          sanitizeGatewayText(args.description.replace(/\p{Cf}/gu, "")),
        )
          .slice(0, 200)
          .join("")) ||
      "MCP composition";
    return getTruncatedText(ctx.lastComponent, [
      `${theme.fg("toolTitle", theme.bold("code"))} ${theme.fg("muted", description)}`,
    ]);
  },
  renderResult(result, { expanded, isPartial }, theme, ctx) {
    const details = result.details as Record<string, unknown> | undefined;
    const failed = ctx.isError || details?.codeError === true;
    const lines = [
      theme.fg(
        isPartial ? "warning" : failed ? "error" : "success",
        isPartial
          ? "running..."
          : `${failed ? "failed" : "completed"} · ${display(details?.calls ?? 0)} calls${details?.code ? ` · ${display(details.code)}` : ""}`,
      ),
    ];
    if (details?.outcomeUnknown)
      lines.push(
        theme.fg("error", "Outcome unknown; do not automatically retry."),
      );
    if (details?.partialExecution)
      lines.push(
        theme.fg("warning", "Partial execution; earlier effects may persist."),
      );
    if (expanded) {
      if (Array.isArray(details?.traces))
        for (const t of details.traces.slice(0, 128)) {
          lines.push(
            theme.fg(
              "muted",
              `${display(t.id)} ${display(t.tool)} · ${display(t.state)} · ${display(t.durationMs)}ms${t.code ? ` · ${display(t.code)}` : ""}${t.reason ? ` (${display(t.reason)})` : ""}${t.invocationId ? ` · ${display(t.invocationId)}` : ""}`,
            ),
          );
        }
      if (details?.spillFilePath)
        lines.push(
          theme.fg("muted", `Output: ${display(details.spillFilePath)}`),
        );
    }
    return getTruncatedText(ctx.lastComponent, lines);
  },
};
