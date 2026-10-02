import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderWorkflowCall, renderWorkflowResult } from "./display.ts";
const theme: any = { bold: (s: string) => s, fg: (_c: string, s: string) => s };
const context = () => ({ state: {}, args: { action: "run" } });

test("workflow call headers retain literal names and targeted identity", () => {
  assert.equal(
    renderWorkflowCall(
      { action: "inspect", id: "abcdefgh-rest" },
      theme,
      context(),
    ).render(80)[0],
    "workflow inspect abcdefgh",
  );
  assert.equal(
    renderWorkflowCall(
      {
        script: 'export const meta = { name: "example", description: "demo" };',
      },
      theme,
      context(),
    ).render(80)[0],
    "workflow run example",
  );
});

test("current inventory, validation and pre-admission errors remain additive", () => {
  for (const [details, text, summary] of [
    [
      {
        action: "list",
        inventory: {
          storeDir: "/tmp/workflows",
          entries: [
            {
              name: "example",
              valid: true,
              description: "a long description for wrapping",
            },
            {
              filename: "broken.js",
              valid: false,
              diagnostic: "invalid definition",
            },
          ],
        },
      },
      "inventory",
      "2 saved workflows",
    ],
    [
      { action: "validate", sourceFile: "inline" },
      "valid",
      "validated (not executed)",
    ],
    [
      { inputError: true },
      "Invalid workflow input: invalid policy",
      "request failed",
    ],
    [{ validationError: true }, "Error: invalid definition", "request failed"],
  ] as const) {
    const result = { details, content: [{ type: "text", text }] };
    const compact = renderWorkflowResult(result, {}, theme, context()).render(
      80,
    );
    const expanded = renderWorkflowResult(
      result,
      { expanded: true },
      theme,
      context(),
    );
    assert.deepEqual(compact, [summary]);
    assert.deepEqual(expanded.render(80).slice(0, 2), [summary, ""]);
    assert.ok(expanded.render(24).every((line) => visibleWidth(line) <= 24));
    assert.doesNotMatch(expanded.render(80).join("\n"), /✓|✗/);
  }
});

test("historical snapshots use original sanitized body rather than elaborate layout", () => {
  const result = {
    details: { snapshot: { agents: [{ intent: "old" }] } },
    content: [
      {
        type: "text",
        text: "historical evidence\n  nested: preserved\n\x1b[2Jfailure evidence",
      },
    ],
  };
  assert.deepEqual(
    renderWorkflowResult(result, { expanded: true }, theme, context()).render(
      80,
    ),
    [
      "historical result",
      "",
      "historical evidence",
      "  nested: preserved",
      "failure evidence",
    ],
  );
});
