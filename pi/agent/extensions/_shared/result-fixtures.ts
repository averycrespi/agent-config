import type { Theme } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { renderExecutionResult } from "../background/render.ts";
import { renderers as mcp } from "../mcp-gateway/tools.ts";
import { renderers as monitor } from "../monitor/tool.ts";
import { renderMailboxResult } from "../mailbox/render.ts";
import { renderers as script } from "../script/tool.ts";
import { renderWorkflowResult } from "../workflows/display.ts";
import { renderAgentsResult } from "../subagents/render.ts";
import { webRenderers } from "../web-access/render.ts";
import { wrapUntrustedContent } from "./untrusted.ts";
import { registerTodoTool } from "../todo/tools.ts";
import { createTodoStore } from "../todo/state.ts";

// Synthetic, loader-inert fixtures; no providers, timers, sessions or execution.
const body =
  '{\n  "nested": {\n    "value": "a long ordinary foreground body with meaningful indentation and enough words to wrap in a narrow terminal"\n  }\n}';
const result = (details: unknown = {}, text = body) => ({
  content: [{ type: "text" as const, text }],
  details,
});
const receipt = {
  id: "example-id",
  label: "Example",
  status: "success",
  createdAt: 0,
  endedAt: 9000,
  activity: { started: 2, completed: 2, failed: 0, canceled: 0 },
};
export async function fixtureTheme(name: "light" | "dark"): Promise<Theme> {
  // Fixture-only access to the locked package's real palettes, without init/watch/reload.
  const url = new URL(
    "./modes/interactive/theme/theme.js",
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  const module = await import(url.href);
  return module.loadThemeFromPath(
    fileURLToPath(new URL(`${name}.json`, url)),
    "truecolor",
  );
}

export function resultFixtures() {
  let todo: any;
  registerTodoTool(
    {
      registerTool: (tool: any) => {
        todo = tool;
      },
    } as any,
    createTodoStore(),
  );
  return [
    {
      name: "background-success",
      render: (expanded: boolean, theme: any) =>
        renderExecutionResult(
          "script",
          [receipt],
          result(),
          { expanded },
          theme,
          { args: { action: "inspect" } },
        ),
    },
    {
      name: "background-canceled",
      render: (expanded: boolean, theme: any) =>
        renderExecutionResult(
          "workflow",
          [
            {
              ...receipt,
              status: "cancelled",
              outcomeUnknown: true,
              result: { errorCode: "cancelled" },
            },
          ],
          result(),
          { expanded },
          theme,
          { args: { action: "inspect" } },
        ),
    },
    {
      name: "mcp-silent",
      render: (expanded: boolean, theme: any) =>
        mcp("mcp_call").renderResult!(
          result() as any,
          { expanded, isPartial: false },
          theme,
          { state: {}, args: {} } as any,
        ),
    },
    {
      name: "web-silent",
      render: (expanded: boolean, theme: any) =>
        webRenderers("web_fetch").renderResult(
          result(),
          { expanded, isPartial: false },
          theme,
          { state: {} },
        ),
    },
    {
      name: "monitor-attention",
      render: (expanded: boolean, theme: any) =>
        monitor.renderResult!(
          result({
            action: "get",
            receipt: {
              id: "example-id",
              name: "Example",
              status: "finished",
              wakes: 0,
              evaluations: 4,
              calls: 0,
              attention: { reason: "condition", disposition: "pending" },
            },
          }) as any,
          { expanded, isPartial: false },
          theme,
          { args: {} } as any,
        ),
    },
    {
      name: "mailbox-message",
      render: (expanded: boolean, theme: any) =>
        renderMailboxResult(
          result(
            {},
            wrapUntrustedContent(
              "MAILBOX RESULT",
              JSON.stringify({
                id: "12345678-1234-1234-1234-123456789abc",
                at: 0,
                type: "report",
                message: body,
              }),
            ),
          ) as any,
          { expanded, isPartial: false },
          theme,
          { args: { action: "send" } },
        ),
    },
    {
      name: "script-trace",
      render: (expanded: boolean, theme: any) =>
        script.renderResult!(
          result({
            action: "run",
            status: "success",
            calls: 1,
            succeeded: 1,
            traces: [
              {
                id: "1",
                tool: "example.read",
                state: "succeeded",
                durationMs: 12,
              },
            ],
          }) as any,
          { expanded, isPartial: false },
          theme,
          { args: { action: "run" } } as any,
        ),
    },
    {
      name: "workflow-inventory",
      render: (expanded: boolean, theme: any) =>
        renderWorkflowResult(
          result({
            action: "list",
            inventory: {
              storeDir: "/example/workflows",
              entries: [
                {
                  name: "example",
                  valid: true,
                  description: "Read-only fixture",
                },
              ],
            },
          }),
          { expanded },
          theme,
          { state: {} },
        ),
    },
    {
      name: "historical-subagent",
      render: (expanded: boolean, theme: any) =>
        renderAgentsResult(
          result({ agents: [{ intent: "Old example" }] }),
          { expanded, isPartial: false },
          theme,
          { state: {}, args: { action: "run" } },
        ),
    },
    {
      name: "mcp-uncertain-failure",
      render: (expanded: boolean, theme: any) =>
        mcp("mcp_call").renderResult!(
          result({ gatewayError: true, outcomeUnknown: true }) as any,
          { expanded, isPartial: false },
          theme,
          { state: {}, args: {} } as any,
        ),
    },
    {
      name: "web-uncertain-failure",
      render: (expanded: boolean, theme: any) =>
        webRenderers("web_fetch").renderResult(
          result({ errorPreview: "failed", outcomeUnknown: true }),
          { expanded, isPartial: false },
          theme,
          { state: {} },
        ),
    },
    {
      name: "mailbox-uncertain-failure",
      render: (expanded: boolean, theme: any) =>
        renderMailboxResult(
          result({ error: "publication_unknown" }) as any,
          { expanded, isPartial: false },
          theme,
          { args: { action: "send" } },
        ),
    },
    {
      name: "monitor-uncertain-failure",
      render: (expanded: boolean, theme: any) =>
        monitor.renderResult!(
          result({
            monitorError: true,
            receipt: { outcomeUnknown: true },
          }) as any,
          { expanded, isPartial: false },
          theme,
          { args: { action: "get" } } as any,
        ),
    },
    {
      name: "todo",
      render: (expanded: boolean, theme: any) =>
        todo.renderResult(
          result(
            { items: [{ id: 1, text: "Example", status: "in_progress" }] },
            "1. [~] Example\n   preserve literal task indentation",
          ),
          { expanded, isPartial: false },
          theme,
          { args: {} },
        ),
    },
  ];
}
