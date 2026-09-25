import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { renderers as script } from "../script/tool.ts";
import { renderAgentsCall, renderAgentsResult } from "../subagents/render.ts";
import {
  renderWorkflowCall,
  renderWorkflowResult,
} from "../workflows/display.ts";

const theme: any = { fg: (_: string, s: string) => s, bold: (s: string) => s };
const id = "11111111-2222-4333-8444-555555555555";
const adapters: any[] = [
  [
    "script",
    script.renderCall,
    script.renderResult,
    (records: unknown[], action: string) => ({
      background: true,
      action,
      records,
    }),
  ],
  [
    "subagents",
    renderAgentsCall,
    renderAgentsResult,
    (records: unknown[], action: string) =>
      action === "list" ? { executions: records } : { execution: records[0] },
  ],
  [
    "workflow",
    renderWorkflowCall,
    renderWorkflowResult,
    (records: unknown[], action: string) => ({ background: records, action }),
  ],
];
for (const [name, call, render, details] of adapters) {
  test(`${name}: only background controls use one-line summaries with expanded evidence`, () => {
    for (const action of [
      "run",
      name === "subagents" ? "list" : "executions",
      "inspect",
      "cancel",
      "dismiss",
    ]) {
      const args = {
        action,
        ...(action === "run" ? { execution: "background" } : {}),
        description: "Demo",
        id,
      };
      const ctx: any = { args, state: {}, invalidate() {} };
      const records = [
        {
          id,
          label: "Demo\n世界\x1b]52;c;HIDDEN\x07",
          status: "success",
          notification: { handoff: "none" },
        },
      ];
      const result = {
        content: [
          { type: "text", text: `UNTRUSTED EVIDENCE\n${id}\nPRIVATE_BODY` },
        ],
        details: details(records, action),
      };
      const before = JSON.stringify(result);
      const header = call(args, theme, ctx).render(120).join("\n");
      assert.match(
        header,
        new RegExp(name === "subagents" ? "subagent" : name),
      );
      assert.doesNotMatch(header, /providers: pending|PRIVATE_BODY/);
      if (
        name === "subagents" &&
        (action === "inspect" || action === "cancel" || action === "dismiss")
      )
        assert.match(header, new RegExp(id.slice(0, 8)));
      const collapsed = render(
        result,
        { expanded: false, isPartial: false },
        theme,
        ctx,
      );
      assert.equal(collapsed.render(120).length, 1);
      assert.match(collapsed.render(120)[0], /^\S/);
      assert.doesNotMatch(collapsed.render(120)[0], /·/);
      assert.doesNotMatch(
        collapsed.render(120)[0],
        /background|11111111|PRIVATE_BODY|HIDDEN/,
      );
      if (action === "run") assert.match(collapsed.render(120)[0], /admitted/);
      if (action === "dismiss")
        assert.equal(collapsed.render(120)[0], "dismissed");
      const expanded = render(
        result,
        { expanded: true, isPartial: false },
        theme,
        ctx,
      );
      assert.match(expanded.render(200).join("\n"), /UNTRUSTED EVIDENCE/);
      assert.match(expanded.render(200).join("\n"), new RegExp(id));
      for (const width of [0, 1, 20, 48, 80])
        for (const component of [collapsed, expanded]) {
          const lines = component.render(width);
          assert.ok(lines.every((s: string) => visibleWidth(s) <= width));
          assert.doesNotMatch(
            stripVTControlCharacters(lines.join("")),
            /[\p{Cc}\p{Cf}]|HIDDEN/u,
          );
        }
      assert.equal(JSON.stringify(result), before);
    }
  });
  test(`${name}: uncertain effects outrank optional labels and framework/semantic failures never succeed`, () => {
    const ctx: any = {
      args: { action: "inspect", description: "x".repeat(200) },
      state: {},
      invalidate() {},
    };
    const records = [
      {
        id,
        label: "x".repeat(200),
        status: "interrupted",
        outcomeUnknown: true,
        effectsMayPersist: true,
      },
    ];
    const result: any = {
      content: [{ type: "text", text: "Error: PRIVATE_DIAGNOSTIC" }],
      details: details(records, "inspect"),
    };
    const lines = render(
      result,
      { expanded: false, isPartial: false },
      theme,
      ctx,
    ).render(48);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /unknown.*no replay/);
    assert.doesNotMatch(lines[0], /PRIVATE|xxxx|success/);
    ctx.isError = true;
    const uncertainFailure = render(
      result,
      { expanded: false, isPartial: false },
      theme,
      ctx,
    ).render(48)[0];
    assert.match(uncertainFailure, /failed.*unknown.*no replay/);
    const error = render(
      { ...result, details: undefined },
      { expanded: false, isPartial: false },
      theme,
      ctx,
    )
      .render(100)
      .join("\n");
    assert.match(error, /request failed/);
    assert.doesNotMatch(error, /PRIVATE|succeeded/);
  });
}
