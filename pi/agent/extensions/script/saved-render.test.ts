import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderers } from "./tool.ts";

test("saved rendering is bounded, context-specific, and hides schemas/arguments/source", () => {
  const theme: any = {
    fg: (_: string, text: string) => text,
    bold: (text: string) => text,
  };
  const details = {
    saved: true,
    entries: [
      {
        name: "bad\x1b]52;c;secret\x07\nname",
        valid: false,
        diagnostic: "invalid_metadata",
        args: { secret: "PRIVATE_SCHEMA" },
      },
    ],
    truncated: true,
  };
  for (const action of ["list", "validate"] as const) {
    assert.equal(
      renderers.renderCall!({ action } as any, theme, {} as any).render(80)[0],
      `script ${action}`,
    );
  }
  for (const action of ["list", "validate"] as const)
    for (const expanded of [false, true])
      for (const isPartial of [false, true])
        for (const isError of [false, true]) {
          const component = renderers.renderResult!(
            { content: [{ type: "text", text: "PRIVATE_PAYLOAD" }], details },
            { expanded, isPartial },
            theme,
            {
              args: { action, args: "PRIVATE_ARGS", source: "PRIVATE_SOURCE" },
              isError,
            } as any,
          );
          for (const width of [12, 60]) {
            const lines = component.render(width);
            assert.ok(lines.every((line) => visibleWidth(line) <= width));
            assert.doesNotMatch(lines.join(""), /PRIVATE_|\x1b\]|secret|\n/);
            if (width === 60)
              assert.match(lines[0], /checking|failed|saved|validated/);
            else assert.match(lines[0], /^\S/);
          }
        }
  const failed = renderers.renderResult!(
    { content: [], details: undefined },
    { expanded: false, isPartial: false },
    theme,
    { args: { action: "validate" }, isError: true } as any,
  );
  assert.equal(failed.render(80)[0], "failed");
});
