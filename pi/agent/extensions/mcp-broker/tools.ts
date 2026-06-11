/**
 * Three Pi tools that wrap the MCP broker:
 *   - mcp_search: list/filter broker tools by name/description substring
 *   - mcp_describe: return full description + input schema for a named tool
 *   - mcp_call: invoke a broker tool with a JSON argument object
 *
 * All three share one BrokerClient via closure so the MCP session is
 * reused across invocations.
 */
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";
import { createManagedLogger } from "../_shared/logging.ts";
import {
  clearPartialTimer,
  countNonEmptyLines,
  firstLine,
  getResultText,
  headNonEmptyLines,
  partialElapsed,
  plural,
} from "../_shared/render.ts";

const CALL_HEAD_LINES = 3;
import type { BrokerClient, BrokerTool } from "./client.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";

const SEARCH_PARAMS = Type.Object({
  query: Type.String({
    description:
      'Case-insensitive substring to match against tool name and description. Pass empty string "" to list everything.',
  }),
});

const DESCRIBE_PARAMS = Type.Object({
  name: Type.String({
    description: "Exact tool name, e.g. 'github.create_pr'.",
  }),
});

const CALL_PARAMS = Type.Object({
  name: Type.String({
    description: "Exact tool name from mcp_search.",
  }),
  arguments: Type.Object(
    {},
    {
      additionalProperties: true,
      description:
        "Arguments matching the tool's inputSchema. Use mcp_describe to see the schema first.",
    },
  ),
});

export function summarize(tool: BrokerTool): string {
  const desc = firstLine(tool.description ?? "");
  return desc ? `${tool.name} — ${desc}` : tool.name;
}

async function logMcpCallFailure(
  toolCallId: string,
  toolName: string,
  message: string,
): Promise<string | undefined> {
  try {
    const logger = createManagedLogger({
      extensionName: "mcp-broker",
      id: `${toolCallId}-failure`,
    });
    logger.write(`mcp_call failure for ${toolName}\n${message}\n`);
    await logger.close();
    return logger.path;
  } catch {
    return undefined;
  }
}

function errorResult(message: string, logFile?: string) {
  const suffix = logFile ? `\nLog: ${logFile}` : "";
  return {
    content: [{ type: "text" as const, text: `${message}${suffix}` }],
    details: logFile ? { logFile } : {},
  };
}

function allText(content: AgentToolResult<unknown>["content"]): string {
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

type CallParams = { name: string; arguments: Record<string, unknown> };

/**
 * Core logic for the mcp_call tool. Exported for unit testing.
 *
 * @param dir - Override spill directory (test-only).
 */
export async function callBrokerTool(
  client: BrokerClient,
  params: CallParams,
  toolCallId: string,
  signal: AbortSignal,
  dir?: string,
  readOnly: boolean = false,
): Promise<{
  content: AgentToolResult<unknown>["content"];
  details: Record<string, unknown>;
}> {
  if (readOnly) {
    try {
      const tools = await client.listTools();
      if (!tools.some((t) => t.name === params.name)) {
        return errorResult(
          `mcp_call: tool '${params.name}' is not available in read-only mode`,
        );
      }
    } catch (err) {
      return errorResult(
        `mcp_call read-only check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  try {
    const result = await client.callTool(params.name, params.arguments, signal);
    const content = (result.content ??
      []) as AgentToolResult<unknown>["content"];
    const brokerError = Boolean(result.isError);
    if (brokerError) {
      content.unshift({
        type: "text" as const,
        text: `[mcp_call: broker tool '${params.name}' reported an error]`,
      });
      const logFile = await logMcpCallFailure(
        toolCallId,
        params.name,
        allText(content),
      );
      return {
        content,
        details: {
          name: params.name,
          brokerError,
          ...(logFile ? { logFile } : {}),
        },
      };
    }
    const spill = await spillIfNeeded(content as any, toolCallId, dir);
    if (spill.spilled) {
      return {
        content: spill.content as AgentToolResult<unknown>["content"],
        details: {
          name: params.name,
          brokerError,
          spilled: true,
          spillFilePath: spill.filePath,
          originalSize: spill.originalSize,
        },
      };
    }
    return {
      content: spill.content as AgentToolResult<unknown>["content"],
      details: { name: params.name, brokerError },
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    const message = err instanceof Error ? err.message : String(err);
    const looksLikeSession = /session/i.test(message);
    if (looksLikeSession) {
      client.reset();
      try {
        const retried = await client.callTool(
          params.name,
          params.arguments,
          signal,
        );
        const retriedContent = (retried.content ??
          []) as AgentToolResult<unknown>["content"];
        const retriedBrokerError = Boolean(retried.isError);
        if (retriedBrokerError) {
          retriedContent.unshift({
            type: "text" as const,
            text: `[mcp_call: broker tool '${params.name}' reported an error]`,
          });
          const logFile = await logMcpCallFailure(
            toolCallId,
            params.name,
            allText(retriedContent),
          );
          return {
            content: retriedContent,
            details: {
              name: params.name,
              brokerError: retriedBrokerError,
              retried: true,
              ...(logFile ? { logFile } : {}),
            },
          };
        }
        const retriedSpill = await spillIfNeeded(
          retriedContent as any,
          toolCallId,
          dir,
        );
        if (retriedSpill.spilled) {
          return {
            content:
              retriedSpill.content as AgentToolResult<unknown>["content"],
            details: {
              name: params.name,
              brokerError: retriedBrokerError,
              retried: true,
              spilled: true,
              spillFilePath: retriedSpill.filePath,
              originalSize: retriedSpill.originalSize,
            },
          };
        }
        return {
          content: retriedSpill.content as AgentToolResult<unknown>["content"],
          details: {
            name: params.name,
            brokerError: retriedBrokerError,
            retried: true,
          },
        };
      } catch (retryErr) {
        const retryMsg =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        const logFile = await logMcpCallFailure(
          toolCallId,
          params.name,
          `mcp_call failed after session retry: ${retryMsg}`,
        );
        return errorResult(
          `mcp_call failed after session retry: ${retryMsg}`,
          logFile,
        );
      }
    }
    const logFile = await logMcpCallFailure(
      toolCallId,
      params.name,
      `mcp_call failed: ${message}`,
    );
    return errorResult(`mcp_call failed: ${message}`, logFile);
  }
}

export function registerTools(
  pi: ExtensionAPI,
  client: BrokerClient,
  ensureConfig?: (ctx: ExtensionContext) => Promise<void>,
): void {
  pi.registerTool({
    name: "mcp_search",
    label: "MCP Search",
    description:
      "Search tools exposed by the MCP broker. Tool names follow <provider>.<tool>. Pass a substring query to filter by name or description, or an empty string to list everything.",
    parameters: SEARCH_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let tools: BrokerTool[];
      try {
        await ensureConfig?.(ctx);
        tools = await client.listTools();
      } catch (err) {
        return errorResult(
          `mcp_search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const q = params.query.trim().toLowerCase();
      const matches = q
        ? tools.filter((t) => {
            const name = t.name.toLowerCase();
            const desc = (t.description ?? "").toLowerCase();
            return name.includes(q) || desc.includes(q);
          })
        : tools;
      const text = matches.length
        ? matches.map(summarize).join("\n")
        : `No broker tools match "${params.query}".`;
      return {
        content: [{ type: "text" as const, text }],
        details: { matchCount: matches.length, totalCount: tools.length },
      };
    },
    renderCall(args, theme, _context) {
      const header = theme.fg("toolTitle", theme.bold("mcp_search"));
      const queryLabel =
        args?.query && args.query.length > 0
          ? theme.fg("accent", `"${args.query}"`)
          : theme.fg("muted", "(all)");
      return new Text(`${header} ${queryLabel}`, 0, 0);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) {
        return new Text(
          theme.fg(
            "warning",
            `Searching broker tools...${partialElapsed(context)}`,
          ),
          0,
          0,
        );
      }
      clearPartialTimer(context);
      const text = getResultText(result);
      if (context.isError) {
        return new Text(
          theme.fg("error", firstLine(text) || "mcp_search error"),
          0,
          0,
        );
      }
      const details = result.details as
        | { matchCount?: number; totalCount?: number }
        | undefined;
      const matchCount = details?.matchCount ?? 0;
      const totalCount = details?.totalCount ?? 0;
      const summary = `${matchCount} matches of ${totalCount} tools`;
      return new Text(theme.fg("muted", summary), 0, 0);
    },
  });

  pi.registerTool({
    name: "mcp_describe",
    label: "MCP Describe",
    description:
      "Return the full description and JSON Schema input for a named broker tool. Use mcp_search first to discover names.",
    parameters: DESCRIBE_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let tools: BrokerTool[];
      try {
        await ensureConfig?.(ctx);
        tools = await client.listTools();
      } catch (err) {
        return errorResult(
          `mcp_describe failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) {
        return errorResult(
          `No broker tool named "${params.name}". Run mcp_search to find available tools.`,
        );
      }
      const schemaJson = JSON.stringify(tool.inputSchema ?? {}, null, 2);
      const text = [
        `Tool: ${tool.name}`,
        "",
        tool.description ?? "(no description)",
        "",
        "Input schema:",
        "```json",
        schemaJson,
        "```",
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: {
          name: tool.name,
          summary: firstLine(tool.description ?? ""),
        },
      };
    },
    renderCall(args, theme, _context) {
      const header = theme.fg("toolTitle", theme.bold("mcp_describe"));
      const nameLabel = args?.name
        ? theme.fg("accent", args.name)
        : theme.fg("muted", "(missing name)");
      return new Text(`${header} ${nameLabel}`, 0, 0);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) {
        const name =
          typeof context.args?.name === "string" && context.args.name.length > 0
            ? context.args.name
            : "broker tool";
        return new Text(
          theme.fg(
            "warning",
            `Describing ${name}...${partialElapsed(context)}`,
          ),
          0,
          0,
        );
      }
      clearPartialTimer(context);
      const text = getResultText(result);
      if (context.isError) {
        return new Text(
          theme.fg("error", firstLine(text) || "mcp_describe error"),
          0,
          0,
        );
      }
      const details = result.details as { summary?: string } | undefined;
      const summary = details?.summary ?? "";
      return new Text(theme.fg("muted", summary), 0, 0);
    },
  });

  pi.registerTool({
    name: "mcp_call",
    label: "MCP Call",
    description:
      "Invoke a broker tool. Use mcp_describe to learn the input schema first. Calls that need human approval block for up to 10 minutes.",
    parameters: CALL_PARAMS,
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      await ensureConfig?.(ctx);
      const sig = signal ?? new AbortController().signal;
      return callBrokerTool(
        client,
        params,
        toolCallId,
        sig,
        undefined,
        client.getReadOnly(),
      );
    },
    renderCall(args, theme, _context) {
      const header = theme.fg("toolTitle", theme.bold("mcp_call"));
      const nameLabel = args?.name
        ? theme.fg("accent", args.name)
        : theme.fg("muted", "(missing name)");
      const argKeys =
        args?.arguments && typeof args.arguments === "object"
          ? Object.keys(args.arguments)
          : [];
      const keysLabel = argKeys.length
        ? ` ${theme.fg("muted", `(${argKeys.join(", ")})`)}`
        : "";
      return new Text(`${header} ${nameLabel}${keysLabel}`, 0, 0);
    },
    renderResult(result, { isPartial }, theme, context) {
      const name = context.args?.name;
      if (isPartial) {
        const subject = name ? `Calling ${name}` : "Calling broker tool";
        return new Text(
          theme.fg("warning", `${subject}...${partialElapsed(context)}`),
          0,
          0,
        );
      }
      clearPartialTimer(context);
      const text = getResultText(result);
      if (context.isError) {
        return new Text(
          theme.fg("error", firstLine(text) || "mcp_call error"),
          0,
          0,
        );
      }
      const details = result.details as { brokerError?: boolean } | undefined;
      if (details?.brokerError) {
        // The execute path unshifts a marker text block onto content
        // when the broker reports an error. getResultText() returns
        // only the first text item (the marker), so pull the underlying
        // error from the text items past the marker instead.
        const textItems = result.content.filter(
          (c): c is { type: "text"; text: string } => c.type === "text",
        );
        const underlyingText = textItems
          .slice(1)
          .map((t) => t.text)
          .join("\n");
        const message = firstLine(underlyingText) || "broker error";
        return new Text(theme.fg("error", `broker error: ${message}`), 0, 0);
      }
      const head = headNonEmptyLines(text, CALL_HEAD_LINES);
      if (head.length === 0) {
        return new Text("", 0, 0);
      }
      const totalLines = countNonEmptyLines(text);
      const extra = totalLines - head.length;
      const displayLines =
        extra > 0 ? [...head, `... +${plural(extra, "more line")}`] : head;
      const rendered = displayLines
        .map((line) => theme.fg("muted", line))
        .join("\n");
      return new Text(rendered, 0, 0);
    },
  });
}
