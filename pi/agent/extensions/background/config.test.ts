import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../script/fixture.ts";
import {
  DEFAULT_WIDGET_CONFIG,
  loadBackgroundConfig,
  parseWidgetConfig,
} from "./config.ts";

test("widget defaults, overrides and invalid values are bounded and value-free", () => {
  assert.deepEqual(parseWidgetConfig({}, {}), DEFAULT_WIDGET_CONFIG);
  for (const value of ["true", "1", "false", "0"])
    assert.equal(
      parseWidgetConfig({}, { BACKGROUND_WIDGETS_AUTO_HIDE: value }).autoHide,
      ["true", "1"].includes(value),
    );
  assert.deepEqual(
    parseWidgetConfig(
      { autoHide: false, terminalHideAfterMs: 2000 },
      {
        BACKGROUND_WIDGETS_AUTO_HIDE: "true",
        BACKGROUND_WIDGETS_TERMINAL_HIDE_AFTER_MS: "0",
      },
    ),
    { autoHide: true, terminalHideAfterMs: 0 },
  );
  for (const invalid of [
    -1,
    1.5,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "PRIVATE",
    {},
    null,
    [],
    false,
  ]) {
    const warnings: string[] = [];
    assert.equal(
      parseWidgetConfig({ terminalHideAfterMs: invalid }, {}, warnings)
        .terminalHideAfterMs,
      15000,
    );
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings.join(""), /PRIVATE/);
  }
  const warnings: string[] = [];
  assert.deepEqual(
    parseWidgetConfig(
      {},
      {
        BACKGROUND_WIDGETS_AUTO_HIDE: "PRIVATE",
        BACKGROUND_WIDGETS_TERMINAL_HIDE_AFTER_MS: "PRIVATE",
      },
      warnings,
    ),
    DEFAULT_WIDGET_CONFIG,
  );
  assert.equal(warnings.length, 2);
  assert.doesNotMatch(warnings.join(""), /PRIVATE/);
});

test("widget fields merge defaults, global, project and environment independently", async (t) => {
  const f = await fixture(t);
  delete process.env.BACKGROUND_WIDGETS_AUTO_HIDE;
  delete process.env.BACKGROUND_WIDGETS_TERMINAL_HIDE_AFTER_MS;
  await writeFile(
    join(f.dir, "settings.json"),
    JSON.stringify({
      "extension:background": {
        widgets: { autoHide: false, terminalHideAfterMs: 3000 },
      },
    }),
  );
  await mkdir(join(f.dir, ".pi"));
  await writeFile(
    join(f.dir, ".pi", "settings.json"),
    JSON.stringify({
      "extension:background": { widgets: { terminalHideAfterMs: 7000 } },
    }),
  );
  assert.deepEqual(await loadBackgroundConfig(f.dir), {
    widgets: { autoHide: false, terminalHideAfterMs: 7000 },
  });
  process.env.BACKGROUND_WIDGETS_AUTO_HIDE = "1";
  assert.deepEqual(await loadBackgroundConfig(f.dir), {
    widgets: { autoHide: true, terminalHideAfterMs: 7000 },
  });
  await writeFile(join(f.dir, ".pi", "settings.json"), '{"PRIVATE');
  const warnings: string[] = [];
  assert.equal(
    (await loadBackgroundConfig(f.dir, warnings)).widgets.terminalHideAfterMs,
    3000,
  );
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings.join(""), /PRIVATE/);
});
