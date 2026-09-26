import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { webRenderers } from "./render.ts";

const theme: any = {
  fg: (_: string, s: string) => {
    assert.doesNotMatch(s, /\x1b|[\p{Cc}\p{Cf}]/u);
    return s;
  },
  bold: (s: string) => s,
};
test("routine web fetch is silent, while spill summaries are muted and expanded paths are labelled", () => {
  const renderer = webRenderers("web_fetch");
  const context: any = {
    args: { url: "https://example.com/page" },
    state: {},
    invalidate() {},
  };
  const result = {
    content: [{ type: "text", text: "framed content" }],
    details: {},
  };
  const call = renderer.renderCall(context.args, theme, context).render(120);
  assert.deepEqual(call, ["web_fetch https://example.com/page"]);
  assert.deepEqual(renderer.renderCall({}, theme, context).render(120), [
    "web_fetch",
  ]);
  assert.deepEqual(
    renderer
      .renderResult(result, { isPartial: false }, theme, context)
      .render(120),
    [],
  );
  const styled: { color: string; text: string }[] = [];
  const spillTheme = {
    ...theme,
    fg: (color: string, text: string) => {
      styled.push({ color, text });
      return theme.fg(color, text);
    },
  };
  const spilled = {
    ...result,
    details: { spilled: true, spillFilePath: "/tmp/example-output.txt" },
  };
  const before = JSON.stringify(spilled);
  assert.deepEqual(
    renderer
      .renderResult(spilled, { isPartial: false }, spillTheme, context)
      .render(120),
    ["output truncated · full response saved to file"],
  );
  assert.ok(
    styled.some(
      ({ color, text }) => color === "muted" && text === "output truncated",
    ),
  );
  assert.ok(
    !styled.some(({ color }) => color === "warning" || color === "error"),
  );
  assert.match(
    renderer
      .renderResult(
        spilled,
        { expanded: true, isPartial: false },
        theme,
        context,
      )
      .render(200)
      .join("\n"),
    /Full response: \/tmp\/example-output.txt/,
  );
  assert.equal(JSON.stringify(spilled), before);
});

test("fetch titles retain paths and useful queries, redact recognizable credentials, and truncate to width", () => {
  const renderer = webRenderers("web_fetch");
  const context: any = { state: {}, invalidate() {} };
  const url =
    "https://user:PASSWORD@example.com/docs/api?version=2&access_token=SECRET&API_KEY=HIDDEN&X-Amz-Signature=SIGNED&%74oken=ENCODED#SECRET";
  const args = { url };
  const title = renderer
    .renderCall(args, theme, context)
    .render(1000)
    .join("\n");
  assert.match(title, /https:\/\/example.com\/docs\/api\?version=2/);
  assert.doesNotMatch(title, /user:|PASSWORD|SECRET|HIDDEN|SIGNED|ENCODED/);
  assert.match(title, /access_token=REDACTED/);
  assert.equal(args.url, url);
  const longUrl = `https://example.com/${"a".repeat(260)}/last?version=2`;
  const longCall = renderer.renderCall({ url: longUrl }, theme, context);
  assert.equal(longCall.render(500).join("\n"), `web_fetch ${longUrl}`);
  assert.match(
    stripVTControlCharacters(longCall.render(48).join("\n")),
    /\.\.\.$/,
  );
  for (const width of [0, 1, 20, 48, 120]) {
    assert.equal(longCall.render(width).length, 1);
    assert.ok(
      longCall
        .render(width)
        .every((line: string) => visibleWidth(line) <= width),
    );
  }
  for (const invalid of [
    "not a URL",
    "data:text/plain,SECRET",
    "file:///SECRET",
    undefined,
  ])
    assert.deepEqual(
      renderer.renderCall({ url: invalid }, theme, context).render(120),
      ["web_fetch"],
    );
});

for (const name of ["web_search", "web_fetch"] as const)
  test(`${name} hides previews, sanitizes before styling and preserves expanded trust framing`, () => {
    const renderer = webRenderers(name);
    const args = {
      query: "例\nquery\x1b]52;c;HIDDEN\x07",
      url: "https://user:PASSWORD@example.com/docs?token=SECRET#SECRET",
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
