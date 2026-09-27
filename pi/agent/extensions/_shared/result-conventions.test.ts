import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import {
  displayBody,
  expandedResult,
  getResultTextComponent,
} from "./render.ts";
import { resultFixtures, fixtureTheme } from "./result-fixtures.ts";
const plain: any = { bold: (s: string) => s, fg: (_c: string, s: string) => s };
const marked: any = {
  bold: (s: string) => `<bold>${s}</bold>`,
  fg: (c: string, s: string) => `<${c}>${s}</${c}>`,
};

for (const fixture of resultFixtures()) {
  test(`${fixture.name}: exact additive prefix, blank-line grammar, actual light/dark widths and immutable projection`, async () => {
    for (const theme of [
      plain,
      await fixtureTheme("light"),
      await fixtureTheme("dark"),
    ]) {
      assert.ok(theme);
      for (const width of [24, 100]) {
        const compact = fixture.render(false, theme).render(width);
        const expanded = fixture.render(true, theme).render(width);
        assert.deepEqual(expanded.slice(0, compact.length), compact);
        if (expanded.length > compact.length && compact.length)
          assert.equal(expanded[compact.length], "");
        else if (!compact.length) assert.notEqual(expanded[0], "");
        assert.ok(
          expanded.every((line: string) => visibleWidth(line) <= width),
        );
        assert.deepEqual(fixture.render(false, theme).render(width), compact);
        assert.doesNotMatch(
          expanded.map(stripVTControlCharacters).join("\n"),
          /\x1b|\u202e/,
        );
      }
    }
  });
}

test("field colors remain independent of lifecycle, telemetry and body", () => {
  const fixtures = resultFixtures();
  const render = (name: string, expanded = false) =>
    fixtures
      .find((f) => f.name === name)!
      .render(expanded, marked)
      .render(4000)
      .join("\n");
  assert.match(
    render("background-success"),
    /<success>succeeded<\/success><dim> · <\/dim><muted>2 done<\/muted><dim> · <\/dim><muted>9s<\/muted>/,
  );
  assert.match(render("background-canceled"), /<warning>canceled<\/warning>/);
  assert.match(
    render("background-canceled"),
    /<warning>outcome unknown; no replay<\/warning>/,
  );
  assert.match(
    render("monitor-attention"),
    /<success>condition met<\/success><dim> · <\/dim><warning>follow-up queued<\/warning><dim> · <\/dim><muted>0 wakes<\/muted>/,
  );
  assert.match(render("monitor-attention"), /<muted>4 evaluations<\/muted>/);
  assert.match(
    render("script-trace", true),
    /<success>succeeded<\/success><dim> · <\/dim><muted>12ms<\/muted>/,
  );
  assert.match(
    render("mailbox-message", true),
    /<muted>  untrusted message:<\/muted>/,
  );
  assert.match(render("mcp-silent", true), /<text>    "value":/);
  for (const fixture of fixtures)
    assert.doesNotMatch(
      fixture.render(true, marked).render(4000).join("\n"),
      /<bold>|<toolTitle>/,
    );
});

test("uncertain failures separate error state from no-replay warnings across affected families", () => {
  for (const fixture of resultFixtures().filter((f) =>
    f.name.endsWith("uncertain-failure"),
  )) {
    for (const expanded of [false, true]) {
      const row = fixture.render(expanded, marked).render(4000)[0];
      assert.match(
        row,
        /^<error>failed<\/error><dim> · <\/dim><warning>.*unknown;? .*no replay<\/warning>$/,
      );
      assert.doesNotMatch(row, /<error>[^<]*unknown|<warning>failed/);
    }
  }
});

test("body sanitization preserves JSON spacing, removes hostile controls and discloses bounded source", () => {
  const input =
    '{\n  "nested": {\n    "value": "a  b"\n  }\n}\x1b]52;c;secret\x07\x1b[2J\u202e';
  const rows = displayBody(input);
  assert.equal(rows[1], '  "nested": {');
  assert.equal(rows[2], '    "value": "a  b"');
  assert.doesNotMatch(rows.join("\n"), /\x1b|secret|\u202e/);
  assert.equal(displayBody("\tvalue")[0], "   value");
  assert.match(displayBody("x".repeat(64001)).at(-1)!, /Display truncated/);
  assert.match(displayBody("line\n".repeat(2001)).at(-1)!, /Display truncated/);
  assert.match(displayBody("x".repeat(4001)).at(-1)!, /Display truncated/);
  const builtin = expandedResult({
    content: [{ type: "text", text: '  "nested":  true' }],
    details: undefined,
  });
  assert.deepEqual(builtin, ['"nested": true']); // Preserve the explicit builtin exception.
});

test("wrapping is bounded, compact remains clipped, and no-detail/silent results add no blank line", () => {
  const summary = "long summary that remains a single clipped line";
  const body = [
    "  nested: an ordinary long line with enough words to wrap",
    "    child: preserved",
  ];
  const component = getResultTextComponent(undefined, [summary], body);
  const narrow = component.render(24);
  assert.equal(
    narrow[0],
    getResultTextComponent(undefined, [summary]).render(24)[0],
  );
  assert.equal(narrow[1], "");
  assert.ok(narrow.length > component.render(100).length);
  assert.match(narrow[2], /^  nested:/);
  assert.ok(narrow.some((row) => row === "    child: preserved"));
  assert.deepEqual(
    getResultTextComponent(undefined, ["validated"]).render(24),
    ["validated"],
  );
  assert.deepEqual(getResultTextComponent(undefined, [], ["body"]).render(24), [
    "body",
  ]);
  assert.deepEqual(getResultTextComponent(undefined, []).render(24), []);
  const bounded = getResultTextComponent(
    undefined,
    [],
    displayBody("word ".repeat(20000)),
  ).render(8);
  assert.ok(bounded.length <= 2001);
  const huge = getResultTextComponent(
    undefined,
    [],
    Array(2000).fill("abcdefgh ".repeat(100)),
  ).render(8);
  assert.equal(huge.length, 2001);
  assert.match(huge.at(-1)!, /^Displ/);
});
