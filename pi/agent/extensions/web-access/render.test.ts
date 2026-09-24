import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { webRenderers } from "./render.ts";

const theme: any = {
  fg: (_: string, s: string) => {
    assert.doesNotMatch(s, /\x1b|[\p{Cc}\p{Cf}]/u);
    return s;
  },
  bold: (s: string) => s,
};
for (const name of ["web_search", "web_fetch"] as const)
  test(`${name} hides previews, sanitizes before styling and preserves expanded trust framing`, () => {
    const renderer = webRenderers(name);
    const args = {
      query: "例\nquery\x1b]52;c;HIDDEN\x07",
      url: "https://user:PASSWORD@example.com/PATH_SECRET?token=SECRET#SECRET",
    };
    const context: any = { args, state: {}, invalidate() {} };
    const body =
      "BEGIN UNTRUSTED EXTERNAL CONTENT\nPRIVATE_RESPONSE\nEND UNTRUSTED EXTERNAL CONTENT";
    const result = {
      content: [{ type: "text", text: body }],
      details: {
        resultCount: 1,
        pageCount: 2,
        previewText: "PRIVATE_RESPONSE",
        title: "PRIVATE_TITLE",
      },
    };
    const before = JSON.stringify(result);
    const call = renderer.renderCall(args, theme, context);
    const collapsed = renderer.renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
      context,
    );
    const expanded = renderer.renderResult(
      result,
      { expanded: true, isPartial: false },
      theme,
      context,
    );
    for (const width of [0, 1, 20, 48, 80, 120]) {
      for (const component of [call, collapsed, expanded])
        assert.ok(
          component
            .render(width)
            .every((s: string) => visibleWidth(s) <= width),
        );
      assert.equal(collapsed.render(width).length, 1);
    }
    assert.doesNotMatch(
      call.render(200)[0] + collapsed.render(200)[0],
      /PRIVATE|PASSWORD|SECRET|HIDDEN/,
    );
    assert.match(
      expanded.render(200).join("\n"),
      /BEGIN UNTRUSTED EXTERNAL CONTENT\nPRIVATE_RESPONSE\nEND UNTRUSTED EXTERNAL CONTENT/,
    );
    assert.equal(JSON.stringify(result), before);
    for (const semantic of [false, true]) {
      const error = renderer.renderResult(
        {
          ...result,
          details: {
            ...result.details,
            errorPreview: semantic ? "PRIVATE_ERROR" : undefined,
          },
        },
        { isPartial: false },
        theme,
        { ...context, isError: !semantic },
      );
      assert.match(error.render(120)[0], /request failed/);
      assert.doesNotMatch(
        error.render(120)[0],
        /PRIVATE_ERROR|page read|result/,
      );
    }
    const unknown = renderer
      .renderResult(
        { ...result, details: { ...result.details, outcomeUnknown: true } },
        { isPartial: false },
        theme,
        context,
      )
      .render(48);
    assert.equal(unknown.length, 1);
    assert.match(unknown[0], /effects unknown; no replay/);
    assert.doesNotMatch(unknown[0], /example|query/);
    const unknownFailure = renderer
      .renderResult(
        { ...result, details: { ...result.details, outcomeUnknown: true } },
        { isPartial: false },
        theme,
        { ...context, isError: true },
      )
      .render(48)[0];
    assert.match(unknownFailure, /failed.*unknown.*no replay/);
    assert.match(
      renderer
        .renderResult(result, { isPartial: true }, theme, context)
        .render(120)[0],
      /reading/,
    );
    assert.ok(context.state.renderTimer);
    renderer.renderResult(result, { isPartial: false }, theme, context);
    assert.equal(context.state.renderTimer, undefined);
  });
